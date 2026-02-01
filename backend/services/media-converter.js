const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { db, log, getSetting } = require('../database');

// In-memory progress tracking (not persisted, lost on restart)
const jobProgress = new Map();

/**
 * Move a file, handling cross-device (EXDEV) errors by falling back to copy+delete
 * @param {string} src - Source path
 * @param {string} dest - Destination path
 */
async function moveFile(src, dest) {
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device link - use copy and delete
      console.log('[MediaConverter] Cross-device move detected, using copy+delete');
      await fs.copyFile(src, dest);
      await fs.unlink(src);
    } else {
      throw err;
    }
  }
}

class MediaConverterService {
  constructor() {
    this.tempPath = getSetting('auto_convert_temp_path') || '/tmp/flexerr-convert';
    this.maxJobs = parseInt(getSetting('auto_convert_max_jobs')) || 1;
    this.activeJobs = 0;
    this.jobQueue = [];
  }

  static isEnabled() {
    return getSetting('auto_convert_enabled') === 'true';
  }

  // Individual conversion type settings
  static isDV5ConversionEnabled() {
    return getSetting('auto_convert_dv5') === 'true';
  }

  static isDV7ConversionEnabled() {
    return getSetting('auto_convert_dv7') === 'true';
  }

  static isDV8ConversionEnabled() {
    return getSetting('auto_convert_dv8') === 'true';
  }

  static isMKVRemuxEnabled() {
    return getSetting('auto_convert_mkv_remux') === 'true';
  }

  static isAV1ConversionEnabled() {
    return getSetting('auto_convert_av1') === 'true';
  }

  static isIncompatibleAudioEnabled() {
    return getSetting('auto_convert_audio') === 'true';
  }

  static getHWAccelSettings() {
    return {
      type: getSetting('auto_convert_hwaccel') || 'vaapi',
      device: getSetting('auto_convert_gpu_device') || '/dev/dri/renderD128',
      codec: getSetting('auto_convert_codec') || 'hevc',
      crf: parseInt(getSetting('auto_convert_crf')) || 18,
      keepOriginal: getSetting('auto_convert_keep_original') === 'true',
      originalSuffix: getSetting('auto_convert_original_suffix') || '.original'
    };
  }

  // Get progress for a job
  static getJobProgress(jobId) {
    return jobProgress.get(jobId) || null;
  }

  // Get all active job progress
  static getAllProgress() {
    const result = {};
    for (const [jobId, progress] of jobProgress) {
      result[jobId] = progress;
    }
    return result;
  }

  // Get jobs that were interrupted (status = 'processing' when server restarted)
  static getInterruptedJobs() {
    return db.prepare(`SELECT * FROM conversion_jobs WHERE status = 'processing' ORDER BY created_at ASC`).all();
  }

  // Restart any interrupted jobs on startup
  async restartInterruptedJobs() {
    if (!MediaConverterService.isEnabled()) {
      return { restarted: 0 };
    }

    const interrupted = MediaConverterService.getInterruptedJobs();
    if (interrupted.length === 0) {
      return { restarted: 0 };
    }

    console.log('[MediaConverter] Found ' + interrupted.length + ' interrupted job(s), restarting...');

    // Clean up any temp files from interrupted jobs
    await this.cleanupTempFiles();

    let restarted = 0;
    for (const job of interrupted) {
      // Check if source file still exists
      try {
        await fs.access(job.file_path);
      } catch (e) {
        console.log('[MediaConverter] Source file missing for job ' + job.id + ', marking as failed');
        this.updateJobStatus(job.id, 'failed', null, 'Source file no longer exists');
        continue;
      }

      // Reset status to pending and re-queue
      db.prepare(`UPDATE conversion_jobs SET status = 'pending' WHERE id = ?`).run(job.id);

      this.addToQueue({
        jobId: job.id,
        filePath: job.file_path,
        title: job.title,
        mediaType: job.media_type,
        tmdbId: job.tmdb_id,
        type: job.conversion_type,
        reason: job.reason,
        duration: job.duration
      });

      console.log('[MediaConverter] Restarted job ' + job.id + ': ' + job.title);
      restarted++;
    }

    return { restarted };
  }

  // Clean up incomplete temp files
  async cleanupTempFiles() {
    try {
      const files = await fs.readdir(this.tempPath);
      for (const file of files) {
        if (file.includes('.converting')) {
          const filePath = path.join(this.tempPath, file);
          await fs.unlink(filePath);
          console.log('[MediaConverter] Cleaned up incomplete temp file: ' + file);
        }
      }
    } catch (e) {
      // Temp directory might not exist yet
      if (e.code !== 'ENOENT') {
        console.error('[MediaConverter] Error cleaning temp files:', e.message);
      }
    }
  }

  async getMediaInfo(filePath) {
    return new Promise((resolve, reject) => {
      const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath];
      const ffprobe = spawn('ffprobe', args);
      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', (data) => { stdout += data; });
      ffprobe.stderr.on('data', (data) => { stderr += data; });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('ffprobe failed: ' + stderr));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error('Failed to parse ffprobe output: ' + e.message));
        }
      });

      ffprobe.on('error', (err) => {
        reject(new Error('Failed to spawn ffprobe: ' + err.message));
      });
    });
  }

  // Parse time string like "00:45:30" to seconds
  parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parseFloat(timeStr) || 0;
  }

  detectDVProfile(mediaInfo) {
    if (!mediaInfo || !mediaInfo.streams) return null;

    for (const stream of mediaInfo.streams) {
      if (stream.codec_type !== 'video') continue;

      const sideDataList = stream.side_data_list || [];
      for (const sideData of sideDataList) {
        if (sideData.side_data_type === 'DOVI configuration record') {
          const profile = sideData.dv_profile;
          return {
            profile,
            level: sideData.dv_level,
            blCompatId: sideData.dv_bl_signal_compatibility_id,
            isProfile5: profile === 5,
            isProfile7: profile === 7,
            isProfile8: profile === 8
          };
        }
      }

      if (stream.codec_tag_string === 'dvhe' || stream.codec_tag_string === 'dvh1') {
        return { hasDV: true, profile: null, needsInspection: true };
      }
    }

    return null;
  }

  // Detect video codec info
  detectVideoCodec(mediaInfo) {
    if (!mediaInfo || !mediaInfo.streams) return null;

    for (const stream of mediaInfo.streams) {
      if (stream.codec_type !== 'video') continue;
      return {
        codec: stream.codec_name,
        profile: stream.profile,
        isAV1: stream.codec_name === 'av1',
        isHEVC: stream.codec_name === 'hevc' || stream.codec_name === 'h265',
        isH264: stream.codec_name === 'h264' || stream.codec_name === 'avc',
        bitDepth: stream.bits_per_raw_sample || (stream.pix_fmt?.includes('10') ? 10 : 8)
      };
    }
    return null;
  }

  // Detect audio codecs that may need conversion
  detectIncompatibleAudio(mediaInfo) {
    if (!mediaInfo || !mediaInfo.streams) return null;

    const incompatibleAudio = [];
    for (const stream of mediaInfo.streams) {
      if (stream.codec_type !== 'audio') continue;

      const codec = stream.codec_name?.toLowerCase();
      // TrueHD and DTS-HD are problematic for many streaming devices
      if (codec === 'truehd' || codec === 'mlp') {
        incompatibleAudio.push({ codec: 'truehd', index: stream.index, channels: stream.channels });
      } else if (codec === 'dts' && (stream.profile?.includes('HD') || stream.profile?.includes('MA'))) {
        incompatibleAudio.push({ codec: 'dts-hd', index: stream.index, channels: stream.channels });
      }
    }

    return incompatibleAudio.length > 0 ? incompatibleAudio : null;
  }

  // Detect container format
  detectContainer(filePath, mediaInfo) {
    const ext = path.extname(filePath).toLowerCase();
    const format = mediaInfo?.format?.format_name || '';

    return {
      extension: ext,
      format,
      isMKV: ext === '.mkv' || format.includes('matroska'),
      isMP4: ext === '.mp4' || ext === '.m4v' || format.includes('mp4'),
      isAVI: ext === '.avi' || format.includes('avi')
    };
  }

  async needsConversion(filePath) {
    try {
      const mediaInfo = await this.getMediaInfo(filePath);
      const dvInfo = this.detectDVProfile(mediaInfo);
      const videoInfo = this.detectVideoCodec(mediaInfo);
      const audioInfo = this.detectIncompatibleAudio(mediaInfo);
      const containerInfo = this.detectContainer(filePath, mediaInfo);

      // Get duration for progress tracking
      const duration = mediaInfo.format?.duration ? parseFloat(mediaInfo.format.duration) : null;

      // Check Dolby Vision profiles (in priority order)
      if (dvInfo) {
        if (dvInfo.isProfile5 && MediaConverterService.isDV5ConversionEnabled()) {
          return {
            needs: true,
            reason: 'Dolby Vision Profile 5 (incompatible with most players)',
            type: 'dv5',
            dvInfo,
            duration
          };
        }
        if (dvInfo.isProfile7 && MediaConverterService.isDV7ConversionEnabled()) {
          return {
            needs: true,
            reason: 'Dolby Vision Profile 7 (limited device support)',
            type: 'dv7',
            dvInfo,
            duration
          };
        }
        if (dvInfo.isProfile8 && MediaConverterService.isDV8ConversionEnabled()) {
          return {
            needs: true,
            reason: 'Dolby Vision Profile 8 (converting to HDR10 for compatibility)',
            type: 'dv8',
            dvInfo,
            duration
          };
        }
      }

      // Check for AV1 codec
      if (videoInfo?.isAV1 && MediaConverterService.isAV1ConversionEnabled()) {
        return {
          needs: true,
          reason: 'AV1 codec (limited device support, converting to HEVC)',
          type: 'av1',
          videoInfo,
          duration
        };
      }

      // Check for MKV container (remux to MP4)
      if (containerInfo.isMKV && MediaConverterService.isMKVRemuxEnabled()) {
        // Only remux if video codec is compatible with MP4
        if (videoInfo?.isHEVC || videoInfo?.isH264) {
          return {
            needs: true,
            reason: 'MKV container (remuxing to MP4 for better compatibility)',
            type: 'mkv_remux',
            containerInfo,
            videoInfo,
            duration
          };
        }
      }

      // Check for incompatible audio (TrueHD, DTS-HD)
      if (audioInfo && MediaConverterService.isIncompatibleAudioEnabled()) {
        return {
          needs: true,
          reason: `Incompatible audio: ${audioInfo.map(a => a.codec).join(', ')} (converting to EAC3)`,
          type: 'audio',
          audioInfo,
          duration
        };
      }

      return { needs: false, duration };
    } catch (e) {
      console.error('[MediaConverter] Error checking file:', e.message);
      return { needs: false, error: e.message };
    }
  }

  async convertDV5ToHDR10(inputPath, outputPath, jobId, totalDuration) {
    const settings = MediaConverterService.getHWAccelSettings();

    await fs.mkdir(this.tempPath, { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [];

      if (settings.type === 'vaapi') {
        args.push('-vaapi_device', settings.device);
        args.push('-i', inputPath);
        args.push('-vf', 'format=p010,hwupload');
        args.push('-c:v', settings.codec === 'h264' ? 'h264_vaapi' : 'hevc_vaapi');
        args.push('-qp', String(settings.crf));
      } else if (settings.type === 'nvenc') {
        args.push('-i', inputPath);
        args.push('-c:v', settings.codec === 'h264' ? 'h264_nvenc' : 'hevc_nvenc');
        args.push('-preset', 'p7');
        args.push('-cq', String(settings.crf));
      } else {
        args.push('-i', inputPath);
        args.push('-c:v', settings.codec === 'h264' ? 'libx264' : 'libx265');
        args.push('-crf', String(settings.crf));
        args.push('-preset', 'medium');
      }

      args.push('-colorspace', 'bt2020nc');
      args.push('-color_primaries', 'bt2020');
      args.push('-color_trc', 'smpte2084');
      args.push('-c:a', 'copy');
      args.push('-c:s', 'copy');
      args.push('-map', '0');
      args.push('-y', outputPath);

      console.log('[MediaConverter] Running: ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        const progressMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (progressMatch) {
          const currentTime = progressMatch[1];
          const currentSeconds = this.parseTimeToSeconds(currentTime);

          // Calculate percentage
          let percent = 0;
          if (totalDuration && totalDuration > 0) {
            percent = Math.min(99, Math.round((currentSeconds / totalDuration) * 100));
          }

          // Update in-memory progress
          jobProgress.set(jobId, {
            currentTime,
            currentSeconds,
            totalDuration,
            percent
          });

          console.log('[MediaConverter] Progress: ' + currentTime + ' (' + percent + '%)');
        }
      });

      ffmpeg.on('close', (code) => {
        // Clear progress on completion
        jobProgress.delete(jobId);

        if (code !== 0) {
          reject(new Error('FFmpeg failed with code ' + code + ': ' + stderr.slice(-500)));
        } else {
          resolve({ success: true, outputPath });
        }
      });

      ffmpeg.on('error', (err) => {
        jobProgress.delete(jobId);
        reject(new Error('Failed to spawn ffmpeg: ' + err.message));
      });
    });
  }

  // Generic DV to HDR10 conversion (works for DV5, DV7, DV8)
  async convertDVToHDR10(inputPath, outputPath, jobId, totalDuration) {
    // Reuse DV5 conversion logic - same process for all DV profiles
    return this.convertDV5ToHDR10(inputPath, outputPath, jobId, totalDuration);
  }

  // Fast MKV to MP4 remux (no re-encoding)
  async remuxMKVToMP4(inputPath, outputPath, jobId, totalDuration) {
    await fs.mkdir(this.tempPath, { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-c', 'copy',           // Copy all streams without re-encoding
        '-movflags', '+faststart', // Optimize for streaming
        '-map', '0',            // Map all streams
        '-y', outputPath
      ];

      console.log('[MediaConverter] Remuxing MKV to MP4: ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        const progressMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (progressMatch) {
          const currentTime = progressMatch[1];
          const currentSeconds = this.parseTimeToSeconds(currentTime);
          let percent = totalDuration > 0 ? Math.min(99, Math.round((currentSeconds / totalDuration) * 100)) : 0;
          jobProgress.set(jobId, { currentTime, currentSeconds, totalDuration, percent });
          console.log('[MediaConverter] Remux Progress: ' + currentTime + ' (' + percent + '%)');
        }
      });

      ffmpeg.on('close', (code) => {
        jobProgress.delete(jobId);
        if (code !== 0) {
          reject(new Error('FFmpeg remux failed with code ' + code + ': ' + stderr.slice(-500)));
        } else {
          resolve({ success: true, outputPath });
        }
      });

      ffmpeg.on('error', (err) => {
        jobProgress.delete(jobId);
        reject(new Error('Failed to spawn ffmpeg: ' + err.message));
      });
    });
  }

  // Convert AV1 to HEVC
  async convertAV1ToHEVC(inputPath, outputPath, jobId, totalDuration) {
    const settings = MediaConverterService.getHWAccelSettings();
    await fs.mkdir(this.tempPath, { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [];

      // AV1 decode + HEVC encode
      if (settings.type === 'nvenc') {
        args.push('-i', inputPath);
        args.push('-c:v', 'hevc_nvenc');
        args.push('-preset', 'p7');
        args.push('-cq', String(settings.crf));
      } else if (settings.type === 'vaapi') {
        args.push('-vaapi_device', settings.device);
        args.push('-i', inputPath);
        args.push('-vf', 'format=nv12,hwupload');
        args.push('-c:v', 'hevc_vaapi');
        args.push('-qp', String(settings.crf));
      } else {
        args.push('-i', inputPath);
        args.push('-c:v', 'libx265');
        args.push('-crf', String(settings.crf));
        args.push('-preset', 'medium');
      }

      args.push('-c:a', 'copy');
      args.push('-c:s', 'copy');
      args.push('-map', '0');
      args.push('-y', outputPath);

      console.log('[MediaConverter] Converting AV1 to HEVC: ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        const progressMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (progressMatch) {
          const currentTime = progressMatch[1];
          const currentSeconds = this.parseTimeToSeconds(currentTime);
          let percent = totalDuration > 0 ? Math.min(99, Math.round((currentSeconds / totalDuration) * 100)) : 0;
          jobProgress.set(jobId, { currentTime, currentSeconds, totalDuration, percent });
          console.log('[MediaConverter] AV1 Progress: ' + currentTime + ' (' + percent + '%)');
        }
      });

      ffmpeg.on('close', (code) => {
        jobProgress.delete(jobId);
        if (code !== 0) {
          reject(new Error('FFmpeg AV1 conversion failed with code ' + code + ': ' + stderr.slice(-500)));
        } else {
          resolve({ success: true, outputPath });
        }
      });

      ffmpeg.on('error', (err) => {
        jobProgress.delete(jobId);
        reject(new Error('Failed to spawn ffmpeg: ' + err.message));
      });
    });
  }

  // Convert incompatible audio (TrueHD, DTS-HD) to EAC3
  async convertIncompatibleAudio(inputPath, outputPath, jobId, totalDuration) {
    await fs.mkdir(this.tempPath, { recursive: true });

    return new Promise((resolve, reject) => {
      // Copy video, convert audio to EAC3 (Dolby Digital Plus) at 640kbps
      const args = [
        '-i', inputPath,
        '-c:v', 'copy',         // Copy video stream
        '-c:a', 'eac3',         // Convert audio to EAC3
        '-b:a', '640k',         // High quality audio bitrate
        '-c:s', 'copy',         // Copy subtitles
        '-map', '0',            // Map all streams
        '-y', outputPath
      ];

      console.log('[MediaConverter] Converting audio to EAC3: ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        const progressMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (progressMatch) {
          const currentTime = progressMatch[1];
          const currentSeconds = this.parseTimeToSeconds(currentTime);
          let percent = totalDuration > 0 ? Math.min(99, Math.round((currentSeconds / totalDuration) * 100)) : 0;
          jobProgress.set(jobId, { currentTime, currentSeconds, totalDuration, percent });
          console.log('[MediaConverter] Audio Progress: ' + currentTime + ' (' + percent + '%)');
        }
      });

      ffmpeg.on('close', (code) => {
        jobProgress.delete(jobId);
        if (code !== 0) {
          reject(new Error('FFmpeg audio conversion failed with code ' + code + ': ' + stderr.slice(-500)));
        } else {
          resolve({ success: true, outputPath });
        }
      });

      ffmpeg.on('error', (err) => {
        jobProgress.delete(jobId);
        reject(new Error('Failed to spawn ffmpeg: ' + err.message));
      });
    });
  }

  async processFile(filePath, title, mediaType, tmdbId) {
    if (!MediaConverterService.isEnabled()) {
      console.log('[MediaConverter] Auto-convert is disabled');
      return { processed: false, reason: 'disabled' };
    }

    const check = await this.needsConversion(filePath);
    if (!check.needs) {
      return { processed: false, reason: 'no conversion needed' };
    }

    console.log('[MediaConverter] File needs conversion:', filePath);
    console.log('[MediaConverter] Reason:', check.reason);
    console.log('[MediaConverter] Duration:', check.duration, 'seconds');

    const jobId = this.createConversionJob(filePath, title, mediaType, tmdbId, check.type, check.reason, check.duration);

    this.addToQueue({
      jobId,
      filePath,
      title,
      mediaType,
      tmdbId,
      type: check.type,
      reason: check.reason,
      duration: check.duration
    });

    return { processed: true, queued: true, jobId, reason: check.reason };
  }

  createConversionJob(filePath, title, mediaType, tmdbId, conversionType, reason, duration = null) {
    const result = db.prepare(`
      INSERT INTO conversion_jobs (
        file_path, title, media_type, tmdb_id, conversion_type,
        reason, status, duration, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
    `).run(filePath, title, mediaType, tmdbId, conversionType, reason, duration);

    return result.lastInsertRowid;
  }

  updateJobStatus(jobId, status, outputPath = null, errorMessage = null) {
    if (status === 'completed' || status === 'failed') {
      db.prepare(`
        UPDATE conversion_jobs
        SET status = ?, output_path = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, outputPath, errorMessage, jobId);
    } else {
      db.prepare(`UPDATE conversion_jobs SET status = ? WHERE id = ?`).run(status, jobId);
    }
  }

  static getPendingJobs() {
    return db.prepare(`SELECT * FROM conversion_jobs WHERE status = 'pending' ORDER BY created_at ASC`).all();
  }

  static getJobs(status = null, limit = 50) {
    if (status) {
      return db.prepare(`SELECT * FROM conversion_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(status, limit);
    }
    return db.prepare(`SELECT * FROM conversion_jobs ORDER BY created_at DESC LIMIT ?`).all(limit);
  }

  addToQueue(job) {
    this.jobQueue.push(job);
    this.processQueue();
  }

  async processQueue() {
    if (this.activeJobs >= this.maxJobs || this.jobQueue.length === 0) {
      return;
    }

    const job = this.jobQueue.shift();
    this.activeJobs++;

    try {
      await this.runConversionJob(job);
    } catch (e) {
      console.error('[MediaConverter] Job failed:', e.message);
    } finally {
      this.activeJobs--;
      this.processQueue();
    }
  }

  async runConversionJob(job) {
    const { jobId, filePath, title, type, duration } = job;
    console.log('[MediaConverter] Starting job ' + jobId + ': ' + title);

    this.updateJobStatus(jobId, 'processing');

    // Initialize progress tracking
    jobProgress.set(jobId, {
      currentTime: '00:00:00',
      currentSeconds: 0,
      totalDuration: duration,
      percent: 0
    });

    try {
      const settings = MediaConverterService.getHWAccelSettings();
      const ext = path.extname(filePath);
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, ext);

      // Determine output extension (changes for MKV remux)
      const outputExt = type === 'mkv_remux' ? '.mp4' : ext;
      const tempOutput = path.join(this.tempPath, base + '.converting' + outputExt);
      const finalOutput = path.join(dir, base + outputExt);

      // Run the appropriate conversion based on type
      switch (type) {
        case 'dv5':
          await this.convertDV5ToHDR10(filePath, tempOutput, jobId, duration);
          break;
        case 'dv7':
        case 'dv8':
          await this.convertDVToHDR10(filePath, tempOutput, jobId, duration);
          break;
        case 'av1':
          await this.convertAV1ToHEVC(filePath, tempOutput, jobId, duration);
          break;
        case 'mkv_remux':
          await this.remuxMKVToMP4(filePath, tempOutput, jobId, duration);
          break;
        case 'audio':
          await this.convertIncompatibleAudio(filePath, tempOutput, jobId, duration);
          break;
        default:
          throw new Error('Unknown conversion type: ' + type);
      }

      if (settings.keepOriginal) {
        const backupPath = filePath + settings.originalSuffix;
        await moveFile(filePath, backupPath);
        console.log('[MediaConverter] Original backed up to: ' + backupPath);
      } else {
        await fs.unlink(filePath);
        console.log('[MediaConverter] Original deleted');
      }

      await moveFile(tempOutput, finalOutput);
      console.log('[MediaConverter] Conversion complete: ' + finalOutput);

      this.updateJobStatus(jobId, 'completed', finalOutput);

      log('info', 'convert', 'Auto-converted media file: ' + title, {
        file_path: finalOutput,
        conversion_type: type,
        job_id: jobId
      });

      return { success: true, outputPath: finalOutput };
    } catch (e) {
      console.error('[MediaConverter] Conversion failed:', e.message);
      this.updateJobStatus(jobId, 'failed', null, e.message);
      jobProgress.delete(jobId);

      log('error', 'convert', 'Conversion failed: ' + title, {
        error: e.message,
        job_id: jobId
      });

      throw e;
    }
  }

  async processNewImport(plexItem) {
    if (!MediaConverterService.isEnabled()) {
      return null;
    }

    const filePath = plexItem.Media?.[0]?.Part?.[0]?.file;
    if (!filePath) {
      console.log('[MediaConverter] No file path for item:', plexItem.title);
      return null;
    }

    const title = plexItem.title || plexItem.grandparentTitle || 'Unknown';
    const mediaType = plexItem.type === 'movie' ? 'movie' : 'episode';
    const tmdbId = null;

    return this.processFile(filePath, title, mediaType, tmdbId);
  }

  async scanLibrary(plexService) {
    if (!MediaConverterService.isEnabled()) {
      return { scanned: 0, needsConversion: 0 };
    }

    console.log('[MediaConverter] Scanning library for files needing conversion...');
    const results = { scanned: 0, needsConversion: 0, queued: [] };

    const libraries = await plexService.getLibraries();
    const movieLibraries = libraries.filter(lib => lib.type === 'movie');
    for (const lib of movieLibraries) {
      const movies = await plexService.getLibraryContents(lib.id);
      for (const movie of movies) {
        const metadata = await plexService.getItemMetadata(movie.ratingKey);
        if (!metadata?.Media?.[0]?.Part?.[0]?.file) continue;

        results.scanned++;
        const filePath = metadata.Media[0].Part[0].file;
        const check = await this.needsConversion(filePath);

        if (check.needs) {
          results.needsConversion++;
          const result = await this.processFile(filePath, movie.title, 'movie', null);
          if (result.queued) {
            results.queued.push({ title: movie.title, jobId: result.jobId, reason: result.reason });
          }
        }
      }
    }

    console.log('[MediaConverter] Scan complete. Scanned: ' + results.scanned + ', Needs conversion: ' + results.needsConversion);
    return results;
  }
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversion_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      title TEXT,
      media_type TEXT,
      tmdb_id INTEGER,
      conversion_type TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      duration REAL,
      output_path TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )
  `);

  // Add duration column if missing (migration)
  try {
    db.prepare(`SELECT duration FROM conversion_jobs LIMIT 1`).get();
  } catch (e) {
    console.log('[MediaConverter] Adding duration column to conversion_jobs table');
    db.exec(`ALTER TABLE conversion_jobs ADD COLUMN duration REAL`);
  }
}

initializeDatabase();

// Auto-restart interrupted jobs on startup
(async () => {
  try {
    const converter = new MediaConverterService();
    const result = await converter.restartInterruptedJobs();
    if (result.restarted > 0) {
      console.log('[MediaConverter] Restarted ' + result.restarted + ' interrupted conversion(s)');
    }
  } catch (e) {
    console.error('[MediaConverter] Error restarting interrupted jobs:', e.message);
  }
})();

module.exports = MediaConverterService;
