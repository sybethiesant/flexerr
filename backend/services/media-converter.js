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
    // Default to /Media/.flexerr-processing (on mounted media volume with more space)
    // Falls back to /tmp if /Media doesn't exist (shouldn't happen in properly configured containers)
    this.tempPath = getSetting('auto_convert_temp_path') || '/Media/.flexerr-processing';
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

  // Alternate release settings
  static isPreferAlternateEnabled() {
    return getSetting('auto_convert_prefer_alternate') === 'true';
  }

  static getAlternateWaitHours() {
    return parseInt(getSetting('auto_convert_alternate_wait')) || 24;
  }

  static isBlocklistBadEnabled() {
    return getSetting('auto_convert_blocklist_bad') === 'true';
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

    console.log('[MediaConverter] Found ' + interrupted.length + ' interrupted job(s), resetting to pending...');

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

      // Reset status to pending - the queue will pick them up one at a time
      db.prepare(`UPDATE conversion_jobs SET status = 'pending' WHERE id = ?`).run(job.id);
      console.log('[MediaConverter] Reset job ' + job.id + ' to pending: ' + job.title);
      restarted++;
    }

    // Start processing the queue (will respect max_jobs limit)
    if (restarted > 0) {
      // Queue the first pending job only - processQueue will handle the rest
      const firstPending = db.prepare(`SELECT * FROM conversion_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`).get();
      if (firstPending) {
        db.prepare(`UPDATE conversion_jobs SET status = 'processing' WHERE id = ?`).run(firstPending.id);
        this.addToQueue({
          jobId: firstPending.id,
          filePath: firstPending.file_path,
          title: firstPending.title,
          mediaType: firstPending.media_type,
          tmdbId: firstPending.tmdb_id,
          type: firstPending.conversion_type,
          reason: firstPending.reason,
          duration: firstPending.duration
        });
      }
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

      console.log('[MediaConverter] Running: nice -n 19 ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('nice', ['-n', '19', 'ffmpeg', ...args]);
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

      console.log('[MediaConverter] Remuxing MKV to MP4: nice -n 19 ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('nice', ['-n', '19', 'ffmpeg', ...args]);
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

      console.log('[MediaConverter] Converting AV1 to HEVC: nice -n 19 ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('nice', ['-n', '19', 'ffmpeg', ...args]);
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

      console.log('[MediaConverter] Converting audio to EAC3: nice -n 19 ffmpeg ' + args.join(' '));
      const ffmpeg = spawn('nice', ['-n', '19', 'ffmpeg', ...args]);
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

  async processFile(filePath, title, mediaType, tmdbId, arrInfo = null) {
    const preferAlternate = MediaConverterService.isPreferAlternateEnabled();
    const conversionEnabled = MediaConverterService.isEnabled();

    // Must have either alternate search or conversion enabled
    if (!preferAlternate && !conversionEnabled) {
      console.log('[MediaConverter] Neither alternate search nor conversion is enabled');
      return { processed: false, reason: 'disabled' };
    }

    const check = await this.needsConversion(filePath);
    if (!check.needs) {
      return { processed: false, reason: 'no conversion needed' };
    }

    console.log('[MediaConverter] Incompatible format detected:', filePath);
    console.log('[MediaConverter] Reason:', check.reason);
    console.log('[MediaConverter] Duration:', check.duration, 'seconds');

    // Check if "Search for Alternate Release" is enabled
    if (preferAlternate && arrInfo) {
      console.log('[MediaConverter] Will search for alternate release first');

      // Queue alternate search
      const searchId = this.createAlternateSearchEntry(
        filePath,
        title,
        mediaType,
        tmdbId,
        check.type,
        check.reason,
        arrInfo
      );

      // Schedule the alternate search workflow
      setImmediate(() => this.runAlternateSearchWorkflow(searchId));

      return {
        processed: true,
        searchingAlternate: true,
        searchId,
        reason: check.reason,
        message: conversionEnabled
          ? 'Searching for alternate release (will convert if none found)'
          : 'Searching for alternate release (conversion disabled)'
      };
    }

    // No arrInfo or alternate search disabled
    if (!conversionEnabled) {
      console.log('[MediaConverter] Conversion disabled and no Sonarr/Radarr info for alternate search');
      return { processed: false, reason: 'conversion disabled, no arr info for alternate search' };
    }

    // Queue conversion immediately
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

  // Create entry in alternate search queue
  createAlternateSearchEntry(filePath, title, mediaType, tmdbId, conversionType, reason, arrInfo) {
    const waitHours = MediaConverterService.getAlternateWaitHours();
    const expiresAt = new Date(Date.now() + waitHours * 60 * 60 * 1000).toISOString();

    const result = db.prepare(`
      INSERT INTO alternate_search_queue (
        file_path, title, media_type, tmdb_id,
        sonarr_series_id, sonarr_episode_id, sonarr_episode_file_id,
        radarr_movie_id, radarr_movie_file_id,
        incompatible_reason, conversion_type, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching', ?)
    `).run(
      filePath,
      title,
      mediaType,
      tmdbId,
      arrInfo.sonarrSeriesId || null,
      arrInfo.sonarrEpisodeId || null,
      arrInfo.sonarrEpisodeFileId || null,
      arrInfo.radarrMovieId || null,
      arrInfo.radarrMovieFileId || null,
      reason,
      conversionType,
      expiresAt
    );

    log('info', 'convert', 'Queued alternate search for: ' + title, {
      search_id: result.lastInsertRowid,
      reason,
      expires_at: expiresAt
    });

    return result.lastInsertRowid;
  }

  // Run the alternate search workflow
  async runAlternateSearchWorkflow(searchId) {
    const entry = db.prepare('SELECT * FROM alternate_search_queue WHERE id = ?').get(searchId);
    if (!entry) {
      console.error('[MediaConverter] Alternate search entry not found:', searchId);
      return;
    }

    console.log('[MediaConverter] Starting alternate search workflow for:', entry.title);

    try {
      // Require services dynamically to avoid circular dependencies
      const SonarrService = require('./sonarr');
      const RadarrService = require('./radarr');

      if (entry.media_type === 'episode' && entry.sonarr_series_id) {
        await this.handleSonarrAlternateSearch(entry, SonarrService);
      } else if (entry.media_type === 'movie' && entry.radarr_movie_id) {
        await this.handleRadarrAlternateSearch(entry, RadarrService);
      } else {
        console.log('[MediaConverter] No Sonarr/Radarr info available, falling back to conversion');
        await this.fallbackToConversion(entry);
      }
    } catch (e) {
      console.error('[MediaConverter] Alternate search workflow failed:', e.message);
      await this.fallbackToConversion(entry);
    }
  }

  // Handle alternate search for TV episodes via Sonarr
  // New approach: File stays in place (playable), we just remove the record and search for replacement
  async handleSonarrAlternateSearch(entry, SonarrService) {
    const sonarr = SonarrService.fromDb();
    if (!sonarr) {
      console.log('[MediaConverter] Sonarr not configured, falling back to conversion');
      return this.fallbackToConversion(entry);
    }

    try {
      // Step 1: Get episode file ID from Sonarr
      const episodes = await sonarr.getEpisodesBySeries(entry.sonarr_series_id);
      const episode = episodes?.find(e => e.id === entry.sonarr_episode_id);
      const episodeFileId = episode?.episodeFileId;

      if (!episodeFileId) {
        console.log('[MediaConverter] No episode file ID found, falling back to conversion');
        return this.fallbackToConversion(entry);
      }

      // Step 2: Temporarily rename the file so Sonarr can't delete it
      const tempPath = entry.file_path + '.flexerr-temp';
      try {
        await fs.rename(entry.file_path, tempPath);
        console.log('[MediaConverter] Temporarily renamed file for protection');
      } catch (e) {
        console.error('[MediaConverter] Failed to rename file:', e.message);
        return this.fallbackToConversion(entry);
      }

      // Step 3: Delete the episode file record (Sonarr will fail to delete physical file, but record is removed)
      try {
        await sonarr.deleteEpisodeFile(episodeFileId);
        console.log('[MediaConverter] Removed episode file record from Sonarr');
      } catch (e) {
        console.log('[MediaConverter] Sonarr deleteEpisodeFile response:', e.message);
        // This might "fail" but the record is usually still removed
      }

      // Step 4: Rename the file back to original (stays playable)
      try {
        await fs.rename(tempPath, entry.file_path);
        console.log('[MediaConverter] Restored original filename - file stays playable');
      } catch (e) {
        console.error('[MediaConverter] Failed to restore filename:', e.message);
        // Try to recover
        try { await fs.rename(tempPath, entry.file_path); } catch {}
      }

      // Step 5: Blocklist the current release if enabled
      if (MediaConverterService.isBlocklistBadEnabled()) {
        console.log('[MediaConverter] Attempting to blocklist incompatible release...');
        try {
          const history = await sonarr.getHistory(entry.sonarr_episode_id, 'downloadFolderImported');
          if (history?.records?.length > 0) {
            const downloadId = history.records[0].downloadId;
            if (downloadId) {
              await sonarr.blockRelease(downloadId);
              console.log('[MediaConverter] Release blocklisted successfully');
            }
          }
        } catch (e) {
          console.log('[MediaConverter] Blocklist attempt:', e.message);
        }
      }

      // Step 6: Trigger search for replacement
      console.log('[MediaConverter] Triggering Sonarr search for replacement...');
      await sonarr.searchEpisodes([entry.sonarr_episode_id]);

      // Step 7: Mark as waiting
      db.prepare(`UPDATE alternate_search_queue SET status = 'waiting', search_attempts = search_attempts + 1 WHERE id = ?`).run(entry.id);

      log('info', 'convert', 'Searching for alternate release (file stays playable): ' + entry.title, { search_id: entry.id });
      console.log('[MediaConverter] Alternate search triggered for:', entry.title);
      console.log('[MediaConverter] File remains playable while waiting up to ' + MediaConverterService.getAlternateWaitHours() + ' hours');

    } catch (e) {
      console.error('[MediaConverter] Sonarr alternate search failed:', e.message);
      return this.fallbackToConversion(entry);
    }
  }

  // Handle alternate search for movies via Radarr
  // New approach: File stays in place (playable), we just remove the record and search for replacement
  async handleRadarrAlternateSearch(entry, RadarrService) {
    const radarr = RadarrService.fromDb();
    if (!radarr) {
      console.log('[MediaConverter] Radarr not configured, falling back to conversion');
      return this.fallbackToConversion(entry);
    }

    try {
      // Step 1: Get movie file ID from Radarr
      const movieFile = await radarr.getMovieFile(entry.radarr_movie_id);
      const movieFileId = movieFile?.id;

      if (!movieFileId) {
        console.log('[MediaConverter] No movie file ID found, falling back to conversion');
        return this.fallbackToConversion(entry);
      }

      // Step 2: Temporarily rename the file so Radarr can't delete it
      const tempPath = entry.file_path + '.flexerr-temp';
      try {
        await fs.rename(entry.file_path, tempPath);
        console.log('[MediaConverter] Temporarily renamed file for protection');
      } catch (e) {
        console.error('[MediaConverter] Failed to rename file:', e.message);
        return this.fallbackToConversion(entry);
      }

      // Step 3: Delete the movie file record (Radarr will fail to delete physical file, but record is removed)
      try {
        await radarr.deleteMovieFile(movieFileId);
        console.log('[MediaConverter] Removed movie file record from Radarr');
      } catch (e) {
        console.log('[MediaConverter] Radarr deleteMovieFile response:', e.message);
        // This might "fail" but the record is usually still removed
      }

      // Step 4: Rename the file back to original (stays playable)
      try {
        await fs.rename(tempPath, entry.file_path);
        console.log('[MediaConverter] Restored original filename - file stays playable');
      } catch (e) {
        console.error('[MediaConverter] Failed to restore filename:', e.message);
        // Try to recover
        try { await fs.rename(tempPath, entry.file_path); } catch {}
      }

      // Step 5: Blocklist the current release if enabled
      if (MediaConverterService.isBlocklistBadEnabled()) {
        console.log('[MediaConverter] Attempting to blocklist incompatible release...');
        try {
          const history = await radarr.getHistory(entry.radarr_movie_id, 'downloadFolderImported');
          if (history?.records?.length > 0) {
            const downloadId = history.records[0].downloadId;
            if (downloadId) {
              await radarr.blockRelease(downloadId);
              console.log('[MediaConverter] Release blocklisted successfully');
            }
          }
        } catch (e) {
          console.log('[MediaConverter] Blocklist attempt:', e.message);
        }
      }

      // Step 6: Trigger search for replacement
      console.log('[MediaConverter] Triggering Radarr search for replacement...');
      await radarr.searchMovie(entry.radarr_movie_id);

      // Step 7: Mark as waiting
      db.prepare(`UPDATE alternate_search_queue SET status = 'waiting', search_attempts = search_attempts + 1 WHERE id = ?`).run(entry.id);

      log('info', 'convert', 'Searching for alternate release (file stays playable): ' + entry.title, { search_id: entry.id });
      console.log('[MediaConverter] Alternate search triggered for:', entry.title);
      console.log('[MediaConverter] File remains playable while waiting up to ' + MediaConverterService.getAlternateWaitHours() + ' hours');

    } catch (e) {
      console.error('[MediaConverter] Radarr alternate search failed:', e.message);
      return this.fallbackToConversion(entry);
    }
  }

  // Legacy quarantine method - now used only for conversion fallback if needed
  async quarantineFile(filePath) {
    try {
      await fs.mkdir(this.tempPath, { recursive: true });
      const fileName = path.basename(filePath);
      const quarantinePath = path.join(this.tempPath, 'quarantine_' + Date.now() + '_' + fileName);
      await moveFile(filePath, quarantinePath);
      console.log('[MediaConverter] Quarantined file: ' + filePath + ' -> ' + quarantinePath);
      return quarantinePath;
    } catch (e) {
      console.error('[MediaConverter] Failed to quarantine file:', e.message);
      return null;
    }
  }

  // Restore a file from quarantine back to its original location
  async restoreFromQuarantine(quarantinePath, originalPath) {
    try {
      // Check if quarantine file exists
      await fs.access(quarantinePath);

      // Make sure the original directory exists
      const dir = path.dirname(originalPath);
      await fs.mkdir(dir, { recursive: true });

      // Move back
      await moveFile(quarantinePath, originalPath);
      console.log('[MediaConverter] Restored file from quarantine: ' + quarantinePath + ' -> ' + originalPath);
      return true;
    } catch (e) {
      console.error('[MediaConverter] Failed to restore from quarantine:', e.message);
      return false;
    }
  }

  // Fall back to conversion when alternate search fails or isn't possible
  async fallbackToConversion(entry) {
    // Check if conversion is enabled
    if (!MediaConverterService.isEnabled()) {
      console.log('[MediaConverter] Conversion disabled - no alternate found for:', entry.title);

      // Clean up quarantined file if it exists and restore original
      if (entry.quarantine_path) {
        const restored = await this.restoreFromQuarantine(entry.quarantine_path, entry.file_path);
        if (restored) {
          console.log('[MediaConverter] Restored original file (conversion disabled)');
        }
      }

      db.prepare(`UPDATE alternate_search_queue SET status = 'resolved', resolution = 'no_alternate_conversion_disabled', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(entry.id);
      log('info', 'convert', 'No alternate found, conversion disabled: ' + entry.title, { search_id: entry.id });
      return;
    }

    console.log('[MediaConverter] Falling back to conversion for:', entry.title);

    let fileToConvert = entry.file_path;

    // Check if file is quarantined and needs to be restored
    if (entry.quarantine_path) {
      try {
        await fs.access(entry.quarantine_path);
        // Restore from quarantine
        const restored = await this.restoreFromQuarantine(entry.quarantine_path, entry.file_path);
        if (!restored) {
          console.log('[MediaConverter] Failed to restore from quarantine, checking original path...');
        }
      } catch (e) {
        console.log('[MediaConverter] Quarantine file not found, checking original path...');
      }
    }

    // Check if file exists at original path (either restored or never quarantined)
    try {
      await fs.access(entry.file_path);
      fileToConvert = entry.file_path;
    } catch (e) {
      // File not at original path, check quarantine
      if (entry.quarantine_path) {
        try {
          await fs.access(entry.quarantine_path);
          // Convert directly from quarantine location
          fileToConvert = entry.quarantine_path;
          console.log('[MediaConverter] Will convert from quarantine location');
        } catch (e2) {
          console.log('[MediaConverter] Source file no longer exists (not at original or quarantine), marking as resolved');
          db.prepare(`UPDATE alternate_search_queue SET status = 'resolved', resolution = 'file_deleted', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(entry.id);
          return;
        }
      } else {
        console.log('[MediaConverter] Source file no longer exists, marking as resolved');
        db.prepare(`UPDATE alternate_search_queue SET status = 'resolved', resolution = 'file_deleted', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(entry.id);
        return;
      }
    }

    // Create conversion job (use fileToConvert which may be quarantine path)
    const mediaInfo = await this.getMediaInfo(fileToConvert);
    const duration = mediaInfo.format?.duration ? parseFloat(mediaInfo.format.duration) : null;

    const jobId = this.createConversionJob(
      fileToConvert,
      entry.title,
      entry.media_type,
      entry.tmdb_id,
      entry.conversion_type,
      entry.incompatible_reason,
      duration
    );

    // Update alternate search entry
    db.prepare(`UPDATE alternate_search_queue SET status = 'converting', resolution = 'no_alternate_found', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(entry.id);

    // Queue the conversion
    this.addToQueue({
      jobId,
      filePath: fileToConvert,
      title: entry.title,
      mediaType: entry.media_type,
      tmdbId: entry.tmdb_id,
      type: entry.conversion_type,
      reason: entry.incompatible_reason,
      duration
    });

    log('info', 'convert', 'No alternate found, falling back to conversion: ' + entry.title, {
      search_id: entry.id,
      job_id: jobId
    });
  }

  // Check all waiting alternate searches for new files or expiration
  static async checkExpiredAlternateSearches() {
    const waiting = db.prepare(`
      SELECT * FROM alternate_search_queue
      WHERE status = 'waiting'
    `).all();

    if (waiting.length === 0) return;

    console.log('[MediaConverter] Checking ' + waiting.length + ' waiting alternate search(es)...');
    const converter = new MediaConverterService();

    for (const entry of waiting) {
      try {
        // Check if a new file has arrived at the original path
        try {
          await fs.access(entry.file_path);

          // New file exists! Check if it's compatible
          console.log('[MediaConverter] New file found at original path for: ' + entry.title);
          const check = await converter.needsConversion(entry.file_path);

          if (!check.needs) {
            // New file is compatible! Delete quarantined file and mark as resolved
            console.log('[MediaConverter] New file is compatible! Cleaning up quarantine for: ' + entry.title);

            if (entry.quarantine_path) {
              try {
                await fs.unlink(entry.quarantine_path);
                console.log('[MediaConverter] Deleted quarantined file: ' + entry.quarantine_path);
              } catch (e) {
                // Quarantine file may already be gone
              }
            }

            db.prepare(`UPDATE alternate_search_queue SET status = 'resolved', resolution = 'alternate_found', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(entry.id);
            log('info', 'convert', 'Found compatible alternate release: ' + entry.title, { search_id: entry.id });
            continue;
          } else {
            // New file also needs conversion - check if it's a different issue
            if (check.type !== entry.conversion_type) {
              console.log('[MediaConverter] New file has different incompatibility (' + check.type + '), will re-queue');
            }
            // Fall through to expiration check - we'll convert if expired
          }
        } catch (e) {
          // No new file at original path yet, check if expired
        }

        // Check if entry has expired
        const expiresAt = new Date(entry.expires_at);
        if (expiresAt < new Date()) {
          console.log('[MediaConverter] Alternate search expired for: ' + entry.title);
          await converter.fallbackToConversion(entry);
        }
      } catch (e) {
        console.error('[MediaConverter] Error checking alternate search entry ' + entry.id + ':', e.message);
      }
    }
  }

  // Get alternate search queue entries
  static getAlternateSearchQueue(status = null) {
    if (status) {
      return db.prepare('SELECT * FROM alternate_search_queue WHERE status = ? ORDER BY created_at DESC').all(status);
    }
    return db.prepare('SELECT * FROM alternate_search_queue ORDER BY created_at DESC LIMIT 100').all();
  }

  // Cancel an alternate search and optionally trigger conversion
  static cancelAlternateSearch(searchId, triggerConversion = false) {
    const entry = db.prepare('SELECT * FROM alternate_search_queue WHERE id = ?').get(searchId);
    if (!entry) return null;

    if (triggerConversion && entry.status !== 'resolved' && entry.status !== 'converting') {
      const converter = new MediaConverterService();
      converter.fallbackToConversion(entry);
    } else {
      db.prepare(`UPDATE alternate_search_queue SET status = 'cancelled', resolution = 'admin_cancelled', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(searchId);
    }

    return { success: true };
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
    if (this.activeJobs >= this.maxJobs) {
      return;
    }

    // First check in-memory queue
    let job = this.jobQueue.shift();

    // If no in-memory jobs, check database for pending jobs
    if (!job) {
      const pending = db.prepare(`SELECT * FROM conversion_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`).get();
      if (pending) {
        job = {
          jobId: pending.id,
          filePath: pending.file_path,
          title: pending.title,
          mediaType: pending.media_type,
          tmdbId: pending.tmdb_id,
          type: pending.conversion_type,
          reason: pending.reason,
          duration: pending.duration
        };
      }
    }

    if (!job) {
      return;
    }

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

    // Try to get Sonarr/Radarr info for alternate release feature
    let arrInfo = null;
    if (MediaConverterService.isPreferAlternateEnabled()) {
      arrInfo = await this.getArrInfoForFile(filePath, mediaType);
    }

    return this.processFile(filePath, title, mediaType, tmdbId, arrInfo);
  }

  // Get Sonarr/Radarr info for a file path
  async getArrInfoForFile(filePath, mediaType) {
    try {
      if (mediaType === 'movie') {
        const RadarrService = require('./radarr');
        const radarr = RadarrService.fromDb();
        if (!radarr) return null;

        // Find the movie by file path
        const movie = await radarr.findMovieByPath(filePath);
        if (movie) {
          return {
            radarrMovieId: movie.id,
            radarrMovieFileId: movie.movieFile?.id || null
          };
        }
      } else if (mediaType === 'episode') {
        const SonarrService = require('./sonarr');
        const sonarr = SonarrService.fromDb();
        if (!sonarr) return null;

        // Get all series and find the one matching the file path
        const allSeries = await sonarr.getSeries();
        for (const series of allSeries) {
          if (filePath.includes(series.path)) {
            // Found the series, now find the episode file
            const episodeFiles = await sonarr.getEpisodeFiles(series.id);
            const epFile = episodeFiles.find(ef => ef.path === filePath);
            if (epFile) {
              // Get the episode ID from the episode file
              const episodes = await sonarr.getEpisodes(series.id);
              const episode = episodes.find(e => e.episodeFileId === epFile.id);
              return {
                sonarrSeriesId: series.id,
                sonarrEpisodeId: episode?.id || null,
                sonarrEpisodeFileId: epFile.id
              };
            }
          }
        }
      }
    } catch (e) {
      console.error('[MediaConverter] Error getting Arr info for file:', e.message);
    }
    return null;
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

  // Table to track incompatible releases awaiting alternates
  db.exec(`
    CREATE TABLE IF NOT EXISTS alternate_search_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      quarantine_path TEXT,
      title TEXT,
      media_type TEXT,
      tmdb_id INTEGER,
      sonarr_series_id INTEGER,
      sonarr_episode_id INTEGER,
      sonarr_episode_file_id INTEGER,
      radarr_movie_id INTEGER,
      radarr_movie_file_id INTEGER,
      incompatible_reason TEXT,
      conversion_type TEXT,
      status TEXT DEFAULT 'searching',
      search_attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      resolved_at TEXT,
      resolution TEXT
    )
  `);

  // Add quarantine_path column if missing (migration)
  try {
    db.prepare(`SELECT quarantine_path FROM alternate_search_queue LIMIT 1`).get();
  } catch (e) {
    console.log('[MediaConverter] Adding quarantine_path column to alternate_search_queue table');
    db.exec(`ALTER TABLE alternate_search_queue ADD COLUMN quarantine_path TEXT`);
  }

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

// Check for expired alternate searches every 30 minutes
setInterval(() => {
  if (MediaConverterService.isEnabled() && MediaConverterService.isPreferAlternateEnabled()) {
    MediaConverterService.checkExpiredAlternateSearches();
  }
}, 30 * 60 * 1000);

// Initial check on startup (delayed to let services initialize)
setTimeout(() => {
  if (MediaConverterService.isEnabled() && MediaConverterService.isPreferAlternateEnabled()) {
    console.log('[MediaConverter] Checking for expired alternate searches...');
    MediaConverterService.checkExpiredAlternateSearches();
  }
}, 30000);

module.exports = MediaConverterService;
