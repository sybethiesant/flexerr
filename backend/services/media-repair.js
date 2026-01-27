const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { db, log, getSetting } = require('../database');
const RadarrService = require('./radarr');
const SonarrService = require('./sonarr');
const NotificationService = require('./notifications');

class MediaRepairService {
  constructor() {
    this.ffmpegPath = getSetting('repair_ffmpeg_path') || 'ffmpeg';
    this.doviToolPath = getSetting('repair_dovi_tool_path') || 'dovi_tool';
    this.tempPath = getSetting('repair_temp_path') || '/tmp/flexerr-repair';
  }

  // Get all repair requests
  static getRepairRequests(userId = null, status = null) {
    let query = `
      SELECT rr.*, u.username
      FROM repair_requests rr
      LEFT JOIN users u ON rr.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ' AND rr.user_id = ?';
      params.push(userId);
    }

    if (status) {
      query += ' AND rr.status = ?';
      params.push(status);
    }

    query += ' ORDER BY rr.created_at DESC';

    return db.prepare(query).all(...params);
  }

  // Get a single repair request
  static getRepairRequest(id) {
    return db.prepare(`
      SELECT rr.*, u.username
      FROM repair_requests rr
      LEFT JOIN users u ON rr.user_id = u.id
      WHERE rr.id = ?
    `).get(id);
  }

  // Create a new repair request
  static createRepairRequest(data) {
    const result = db.prepare(`
      INSERT INTO repair_requests (
        user_id, tmdb_id, media_type, title, year, poster_path,
        radarr_id, sonarr_id, request_type, reason,
        current_quality, requested_quality, current_file_path,
        file_size_bytes, dv_profile, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      data.user_id,
      data.tmdb_id,
      data.media_type,
      data.title,
      data.year || null,
      data.poster_path || null,
      data.radarr_id || null,
      data.sonarr_id || null,
      data.request_type,
      data.reason || null,
      data.current_quality || null,
      data.requested_quality || null,
      data.current_file_path || null,
      data.file_size_bytes || null,
      data.dv_profile || null
    );

    log('info', 'repair', `Repair request created: ${data.title}`, {
      user_id: data.user_id,
      tmdb_id: data.tmdb_id,
      media_type: data.media_type,
      request_type: data.request_type
    });

    return result.lastInsertRowid;
  }

  // Blacklist a release in Radarr
  async blacklistRadarrRelease(movieId, movieFileId) {
    const radarr = RadarrService.fromDb();
    if (!radarr) {
      throw new Error('Radarr not configured');
    }

    try {
      // Get movie file info first
      const movie = await radarr.getMovieById(movieId);
      if (!movie.movieFile) {
        throw new Error('No movie file to blacklist');
      }

      // Delete and blacklist the release
      // Radarr v3 API: DELETE /moviefile/{id} with addToBlocklist=true
      await radarr.client.delete(`/moviefile/${movie.movieFile.id}`, {
        params: { addToBlocklist: true }
      });

      log('info', 'repair', `Blacklisted movie release in Radarr`, {
        movie_id: movieId,
        file_id: movie.movieFile.id
      });

      return true;
    } catch (error) {
      console.error('[MediaRepair] Blacklist error:', error.message);
      throw error;
    }
  }

  // Blacklist a release in Sonarr
  async blacklistSonarrRelease(seriesId, episodeFileId) {
    const sonarr = SonarrService.fromDb();
    if (!sonarr) {
      throw new Error('Sonarr not configured');
    }

    try {
      // Sonarr v3 API: DELETE /episodefile/{id} with addToBlocklist=true
      await sonarr.client.delete(`/episodefile/${episodeFileId}`, {
        params: { addToBlocklist: true }
      });

      log('info', 'repair', `Blacklisted episode release in Sonarr`, {
        series_id: seriesId,
        file_id: episodeFileId
      });

      return true;
    } catch (error) {
      console.error('[MediaRepair] Blacklist error:', error.message);
      throw error;
    }
  }

  // Update repair request status
  static updateRepairStatus(id, status, errorMessage = null) {
    const processedAt = status === 'completed' || status === 'failed' ? 'CURRENT_TIMESTAMP' : null;

    if (processedAt) {
      db.prepare(`
        UPDATE repair_requests
        SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, errorMessage, id);
    } else {
      db.prepare(`
        UPDATE repair_requests
        SET status = ?, error_message = ?
        WHERE id = ?
      `).run(status, errorMessage, id);
    }
  }

  // Delete a repair request
  static deleteRepairRequest(id) {
    db.prepare('DELETE FROM repair_requests WHERE id = ?').run(id);
  }

  // Run ffprobe to get media info
  async getMediaInfo(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ];

      const ffprobe = spawn('ffprobe', args);
      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', (data) => {
        stdout += data;
      });

      ffprobe.stderr.on('data', (data) => {
        stderr += data;
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
        }
      });
    });
  }

  // Detect Dolby Vision profile from media info
  detectDVProfile(mediaInfo) {
    if (!mediaInfo || !mediaInfo.streams) return null;

    for (const stream of mediaInfo.streams) {
      if (stream.codec_type !== 'video') continue;

      // Check for Dolby Vision
      const sideDataList = stream.side_data_list || [];
      for (const sideData of sideDataList) {
        if (sideData.side_data_type === 'DOVI configuration record') {
          const dvProfile = sideData.dv_profile;
          const dvLevel = sideData.dv_level;
          const blCompatId = sideData.dv_bl_signal_compatibility_id;

          return {
            profile: dvProfile,
            level: dvLevel,
            blCompatId: blCompatId,
            isProfile5: dvProfile === 5,
            needsConversion: dvProfile === 5, // Profile 5 needs conversion for Plex
            rawData: sideData
          };
        }
      }

      // Alternative detection via codec tags
      if (stream.codec_tag_string === 'dvhe' || stream.codec_tag_string === 'dvh1') {
        // This is DV, but we need ffprobe with newer version to get profile
        return {
          hasDV: true,
          profile: null,
          needsInspection: true
        };
      }
    }

    return null;
  }

  // Get video quality info
  getQualityInfo(mediaInfo) {
    if (!mediaInfo || !mediaInfo.streams) return null;

    const videoStream = mediaInfo.streams.find(s => s.codec_type === 'video');
    if (!videoStream) return null;

    const width = videoStream.width;
    const height = videoStream.height;
    const bitrate = videoStream.bit_rate || mediaInfo.format?.bit_rate;
    const codec = videoStream.codec_name;

    let resolution = 'Unknown';
    if (height >= 2160 || width >= 3840) resolution = '4K';
    else if (height >= 1080 || width >= 1920) resolution = '1080p';
    else if (height >= 720 || width >= 1280) resolution = '720p';
    else if (height >= 480 || width >= 720) resolution = '480p';

    // Check for HDR
    const colorTransfer = videoStream.color_transfer;
    const colorPrimaries = videoStream.color_primaries;
    const isHDR = colorTransfer === 'smpte2084' || colorTransfer === 'arib-std-b67';
    const isDV = this.detectDVProfile(mediaInfo) !== null;

    return {
      width,
      height,
      resolution,
      codec,
      bitrate: bitrate ? parseInt(bitrate) : null,
      isHDR,
      isDV,
      colorTransfer,
      colorPrimaries
    };
  }

  // Convert DV Profile 5 to Profile 8.1
  async convertDVProfile5(inputPath, outputPath) {
    // Step 1: Extract HEVC stream with DV RPU
    const hevcPath = path.join(this.tempPath, 'temp_hevc.hevc');
    const rpuPath = path.join(this.tempPath, 'temp_rpu.bin');
    const convertedRpuPath = path.join(this.tempPath, 'converted_rpu.bin');

    try {
      // Ensure temp directory exists
      await fs.mkdir(this.tempPath, { recursive: true });

      // Extract HEVC stream
      console.log('[MediaRepair] Extracting HEVC stream...');
      await this.runCommand(this.ffmpegPath, [
        '-i', inputPath,
        '-c:v', 'copy',
        '-bsf:v', 'hevc_mp4toannexb',
        '-f', 'hevc',
        hevcPath
      ]);

      // Extract RPU using dovi_tool
      console.log('[MediaRepair] Extracting RPU...');
      await this.runCommand(this.doviToolPath, [
        'extract-rpu',
        '-i', hevcPath,
        '-o', rpuPath
      ]);

      // Convert RPU from Profile 5 to Profile 8.1
      console.log('[MediaRepair] Converting RPU to Profile 8.1...');
      await this.runCommand(this.doviToolPath, [
        'convert',
        '--mode', '2', // Mode 2 converts to Profile 8.1
        '-i', rpuPath,
        '-o', convertedRpuPath
      ]);

      // Inject converted RPU back into HEVC stream
      const injectedPath = path.join(this.tempPath, 'injected.hevc');
      console.log('[MediaRepair] Injecting converted RPU...');
      await this.runCommand(this.doviToolPath, [
        'inject-rpu',
        '-i', hevcPath,
        '-r', convertedRpuPath,
        '-o', injectedPath
      ]);

      // Remux with original audio/subtitle streams
      console.log('[MediaRepair] Remuxing final file...');
      await this.runCommand(this.ffmpegPath, [
        '-i', injectedPath,
        '-i', inputPath,
        '-map', '0:v',
        '-map', '1:a?',
        '-map', '1:s?',
        '-c', 'copy',
        '-y',
        outputPath
      ]);

      console.log('[MediaRepair] Conversion complete!');

      // Cleanup temp files
      await this.cleanupTempFiles([hevcPath, rpuPath, convertedRpuPath, injectedPath]);

      return { success: true, outputPath };
    } catch (error) {
      // Cleanup on error
      await this.cleanupTempFiles([hevcPath, rpuPath, convertedRpuPath]);
      throw error;
    }
  }

  // Run a command and return promise
  runCommand(command, args) {
    return new Promise((resolve, reject) => {
      console.log(`[MediaRepair] Running: ${command} ${args.join(' ')}`);
      const proc = spawn(command, args);
      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run command: ${err.message}`));
      });
    });
  }

  // Cleanup temp files
  async cleanupTempFiles(files) {
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  // Process a quality upgrade request or wrong content replacement
  async processQualityUpgrade(requestId, blacklistCurrent = false) {
    const request = MediaRepairService.getRepairRequest(requestId);
    if (!request) {
      throw new Error('Repair request not found');
    }

    MediaRepairService.updateRepairStatus(requestId, 'processing');

    try {
      if (request.media_type === 'movie') {
        const radarr = RadarrService.fromDb();
        if (!radarr) {
          throw new Error('Radarr not configured');
        }

        const movie = await radarr.getMovieByTmdbId(request.tmdb_id);
        if (!movie) {
          throw new Error('Movie not found in Radarr');
        }

        // Delete or blacklist current file if exists
        if (movie.movieFile) {
          if (blacklistCurrent || request.request_type === 'wrong_content') {
            console.log(`[MediaRepair] Blacklisting current movie file...`);
            await this.blacklistRadarrRelease(movie.id, movie.movieFile.id);
          } else {
            console.log(`[MediaRepair] Deleting current movie file...`);
            await radarr.deleteMovieFile(movie.movieFile.id);
          }
        }

        // Trigger new search
        console.log(`[MediaRepair] Triggering search for replacement...`);
        await radarr.searchMovie(movie.id);

        MediaRepairService.updateRepairStatus(requestId, 'completed');

        log('info', 'repair', `Quality upgrade triggered for: ${request.title}`, {
          tmdb_id: request.tmdb_id,
          request_id: requestId,
          blacklisted: blacklistCurrent || request.request_type === 'wrong_content'
        });

        return { success: true, message: 'Search triggered for replacement', blacklisted: blacklistCurrent };
      } else {
        // TV show upgrade (more complex, need to handle series/episodes)
        const sonarr = SonarrService.fromDb();
        if (!sonarr) {
          throw new Error('Sonarr not configured');
        }

        // Sonarr uses TVDB IDs, not TMDB IDs
        if (!request.tvdb_id) {
          throw new Error('TVDB ID required for TV series lookup in Sonarr');
        }
        const series = await sonarr.getSeriesByTvdbId(request.tvdb_id);
        if (!series) {
          throw new Error('Series not found in Sonarr');
        }

        // If blacklisting, delete all episode files with blacklist
        if (blacklistCurrent || request.request_type === 'wrong_content') {
          console.log(`[MediaRepair] Blacklisting current episode files...`);
          const episodeFiles = await sonarr.getEpisodeFiles(series.id);
          for (const file of episodeFiles) {
            try {
              await this.blacklistSonarrRelease(series.id, file.id);
            } catch (e) {
              console.warn(`[MediaRepair] Failed to blacklist file ${file.id}:`, e.message);
            }
          }
        }

        // Trigger series search for upgrades
        await sonarr.searchSeries(series.id);

        MediaRepairService.updateRepairStatus(requestId, 'completed');

        return { success: true, message: 'Search triggered for replacement' };
      }
    } catch (error) {
      MediaRepairService.updateRepairStatus(requestId, 'failed', error.message);
      throw error;
    }
  }

  // Process DV Profile 5 conversion
  async processDVConversion(requestId) {
    const request = MediaRepairService.getRepairRequest(requestId);
    if (!request) {
      throw new Error('Repair request not found');
    }

    if (!request.current_file_path) {
      throw new Error('No file path specified for conversion');
    }

    MediaRepairService.updateRepairStatus(requestId, 'processing');

    try {
      const inputPath = request.current_file_path;
      const ext = path.extname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const dirName = path.dirname(inputPath);
      const outputPath = path.join(dirName, `${baseName}.DV8.1${ext}`);

      // Perform the conversion
      const result = await this.convertDVProfile5(inputPath, outputPath);

      if (result.success) {
        // Rename original and new file
        const backupPath = path.join(dirName, `${baseName}.DV5.backup${ext}`);
        await fs.rename(inputPath, backupPath);
        await fs.rename(outputPath, inputPath);

        MediaRepairService.updateRepairStatus(requestId, 'completed');

        log('info', 'repair', `DV Profile 5 converted to 8.1: ${request.title}`, {
          tmdb_id: request.tmdb_id,
          request_id: requestId,
          original_backup: backupPath
        });

        // Notify about completion
        try {
          await NotificationService.notify('on_available', {
            title: `Repair Complete: ${request.title}`,
            action: 'DV Profile 5 converted to Profile 8.1',
            mediaType: request.media_type
          });
        } catch (e) {
          console.error('[MediaRepair] Notification failed:', e.message);
        }

        return { success: true, message: 'DV Profile 5 converted to 8.1', backupPath };
      }
    } catch (error) {
      MediaRepairService.updateRepairStatus(requestId, 'failed', error.message);
      throw error;
    }
  }

  // Scan library for DV Profile 5 content
  async scanForDVProfile5() {
    console.log('[MediaRepair] Scanning library for DV Profile 5 content...');
    const dvProfile5Items = [];

    // Scan Radarr movies
    const radarr = RadarrService.fromDb();
    if (radarr) {
      try {
        const movies = await radarr.getMovies();
        for (const movie of movies) {
          if (!movie.movieFile?.path) continue;

          try {
            const mediaInfo = await this.getMediaInfo(movie.movieFile.path);
            const dvInfo = this.detectDVProfile(mediaInfo);

            if (dvInfo && dvInfo.isProfile5) {
              dvProfile5Items.push({
                title: movie.title,
                year: movie.year,
                tmdb_id: movie.tmdbId,
                media_type: 'movie',
                radarr_id: movie.id,
                file_path: movie.movieFile.path,
                file_size: movie.movieFile.size,
                dv_profile: dvInfo
              });
            }
          } catch (e) {
            // Skip files that can't be analyzed
            console.warn(`[MediaRepair] Failed to analyze: ${movie.title}`, e.message);
          }
        }
      } catch (e) {
        console.error('[MediaRepair] Radarr scan failed:', e.message);
      }
    }

    log('info', 'repair', `DV Profile 5 scan complete`, {
      found_count: dvProfile5Items.length
    });

    return dvProfile5Items;
  }

  // Auto-create repair requests for DV Profile 5 items
  async autoRepairDVProfile5(userId) {
    const items = await this.scanForDVProfile5();
    const created = [];

    for (const item of items) {
      // Check if repair request already exists
      const existing = db.prepare(`
        SELECT id FROM repair_requests
        WHERE tmdb_id = ? AND media_type = ? AND request_type = 'dv_conversion'
        AND status IN ('pending', 'processing')
      `).get(item.tmdb_id, item.media_type);

      if (!existing) {
        const id = MediaRepairService.createRepairRequest({
          user_id: userId,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title,
          year: item.year,
          radarr_id: item.radarr_id,
          request_type: 'dv_conversion',
          reason: 'Auto-detected DV Profile 5',
          current_file_path: item.file_path,
          file_size_bytes: item.file_size,
          dv_profile: JSON.stringify(item.dv_profile)
        });
        created.push({ id, ...item });
      }
    }

    return created;
  }

  // Get media file info for a request/movie
  async getFileInfo(tmdbId, mediaType) {
    if (mediaType === 'movie') {
      const radarr = RadarrService.fromDb();
      if (!radarr) return null;

      const movie = await radarr.getMovieByTmdbId(tmdbId);
      if (!movie || !movie.movieFile) return null;

      let mediaInfo = null;
      let dvInfo = null;
      let qualityInfo = null;

      try {
        mediaInfo = await this.getMediaInfo(movie.movieFile.path);
        dvInfo = this.detectDVProfile(mediaInfo);
        qualityInfo = this.getQualityInfo(mediaInfo);
      } catch (e) {
        console.warn('[MediaRepair] Failed to get media info:', e.message);
      }

      return {
        path: movie.movieFile.path,
        size: movie.movieFile.size,
        quality: movie.movieFile.quality?.quality?.name,
        mediaGroup: movie.movieFile.mediaInfo?.videoCodec,
        releaseGroup: movie.movieFile.releaseGroup,
        dvInfo,
        qualityInfo,
        radarrId: movie.id
      };
    }

    return null;
  }
}

module.exports = MediaRepairService;
