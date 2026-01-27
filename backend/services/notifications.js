const axios = require('axios');
const { db, log } = require('../database');

class NotificationService {
  // Get all active webhooks
  static getWebhooks() {
    return db.prepare('SELECT * FROM webhooks WHERE is_active = 1').all();
  }

  // Map trigger names to database column names
  // Note: DB columns are on_request, on_available, on_leaving_soon, on_delete, on_restore, on_error
  static triggerToColumn(trigger) {
    const mapping = {
      'on_request': 'on_request',
      'on_watchlist_add': 'on_request',      // Watchlist add creates a request
      'on_queue_add': 'on_leaving_soon',     // Queue items are "leaving soon"
      'on_delete': 'on_delete',
      'on_available': 'on_available',
      'on_rule_complete': 'on_delete',       // Rule completion typically means deletion
      'on_error': 'on_error',
      'on_service_down': 'on_error',         // Service down is an error condition
      'on_restore': 'on_restore'             // Explicit restore mapping
    };
    return mapping[trigger] || trigger;
  }

  // Get webhooks for a specific trigger
  static getWebhooksForTrigger(trigger, ruleId = null) {
    let webhooks = this.getWebhooks();

    // Filter by trigger type (map to DB column name)
    const dbColumn = this.triggerToColumn(trigger);
    webhooks = webhooks.filter(w => w[dbColumn]);

    // Filter by rule if specified
    if (ruleId) {
      webhooks = webhooks.filter(w => {
        if (!w.rule_ids) return true;
        try {
          const ruleIds = JSON.parse(w.rule_ids);
          return !Array.isArray(ruleIds) || ruleIds.length === 0 || ruleIds.includes(ruleId);
        } catch (e) {
          console.warn(`[Notifications] Invalid rule_ids JSON for webhook ${w.id}: ${w.rule_ids}`);
          return true; // Include webhook if rule_ids is malformed
        }
      });
    }

    return webhooks;
  }

  // Send notification to all relevant webhooks
  static async notify(trigger, data, ruleId = null) {
    const webhooks = this.getWebhooksForTrigger(trigger, ruleId);

    console.log(`[Notifications] Trigger: ${trigger}, Found ${webhooks.length} matching webhooks`);

    for (const webhook of webhooks) {
      try {
        console.log(`[Notifications] Sending to webhook: ${webhook.name} (${webhook.type})`);
        await this.sendWebhook(webhook, trigger, data);
        console.log(`[Notifications] Successfully sent to ${webhook.name}`);
      } catch (error) {
        console.error(`[Notifications] Failed to send to ${webhook.name}:`, error.message);
        log('error', 'notification', `Webhook failed: ${webhook.name}`, {
          webhook_id: webhook.id,
          error: error.message
        });
      }
    }
  }

  // Send to a specific webhook
  static async sendWebhook(webhook, trigger, data) {
    let settings = {};
    if (webhook.settings) {
      try {
        settings = JSON.parse(webhook.settings);
      } catch (e) {
        console.warn(`[Notifications] Invalid JSON in webhook settings for ${webhook.name}:`, e.message);
      }
    }

    switch (webhook.type) {
      case 'discord':
        await this.sendDiscord(webhook.url, trigger, data, settings);
        break;
      case 'slack':
        await this.sendSlack(webhook.url, trigger, data, settings);
        break;
      case 'gotify':
        await this.sendGotify(webhook.url, trigger, data, settings);
        break;
      case 'pushover':
        await this.sendPushover(settings, trigger, data);
        break;
      case 'ntfy':
        await this.sendNtfy(webhook.url, trigger, data, settings);
        break;
      case 'email':
        await this.sendEmail(settings, trigger, data);
        break;
      case 'custom':
        await this.sendCustom(webhook.url, trigger, data, settings);
        break;
      default:
        console.warn(`Unknown webhook type: ${webhook.type}`);
    }
  }

  // Discord webhook
  static async sendDiscord(url, trigger, data, settings = {}) {
    const triggerLabels = {
      on_request: 'New Request',
      on_watchlist_add: 'Added to Watchlist',
      on_available: 'Now Available',
      on_queue_add: 'Added to Leaving Soon',
      on_delete: 'Deleted',
      on_rule_complete: 'Rule Completed',
      on_error: 'Error',
      on_service_down: 'Service Down'
    };

    const colors = {
      on_request: 0x3b82f6,   // Blue
      on_watchlist_add: 0x3b82f6, // Blue
      on_available: 0x22c55e, // Green
      on_queue_add: 0xf59e0b, // Yellow/orange
      on_delete: 0xef4444,    // Red
      on_rule_complete: 0x22c55e, // Green
      on_error: 0xdc2626,     // Dark red
      on_service_down: 0x991b1b // Darker red
    };

    const embed = {
      title: `Flexerr: ${triggerLabels[trigger] || trigger}`,
      color: colors[trigger] || 0x6366f1,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Flexerr'
      }
    };

    // Add content based on trigger type
    if (data.title) {
      // For cleanup summaries, use title as embed title and message as description
      if (data.type === 'smart_cleanup' || data.type === 'movie_cleanup') {
        embed.title = `Flexerr: ${data.title}`;
        embed.description = data.message || '';
        if (data.details) {
          embed.description += '\n\n' + data.details;
        }
      } else {
        embed.description = `**${data.title}**${data.year ? ` (${data.year})` : ''}`;
      }
    } else if (data.message) {
      embed.description = data.message;
    }

    if (data.poster) {
      embed.thumbnail = { url: data.poster };
    }

    const fields = [];

    if (data.user) {
      fields.push({ name: 'Requested By', value: data.user, inline: true });
    }

    if (data.mediaType) {
      fields.push({ name: 'Type', value: data.mediaType === 'tv' ? 'TV Show' : 'Movie', inline: true });
    }

    if (data.rule) {
      fields.push({ name: 'Rule', value: data.rule, inline: true });
    }

    if (data.action) {
      fields.push({ name: 'Action', value: data.action, inline: true });
    }

    if (data.daysRemaining !== undefined) {
      fields.push({ name: 'Days Until Deletion', value: data.daysRemaining.toString(), inline: true });
    }

    if (data.error) {
      fields.push({ name: 'Error', value: data.error });
    }

    if (data.stats) {
      // Handle stats as either string or object
      if (typeof data.stats === 'string') {
        fields.push({ name: 'Statistics', value: data.stats });
      } else if (typeof data.stats === 'object') {
        const statsStr = Object.entries(data.stats)
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
          .join(' | ');
        fields.push({ name: 'Statistics', value: statsStr });
      }
    }

    if (fields.length > 0) {
      embed.fields = fields;
    }

    await axios.post(url, {
      username: settings.username || 'Flexerr',
      avatar_url: settings.avatar_url,
      embeds: [embed]
    });
  }

  // Slack webhook
  static async sendSlack(url, trigger, data, settings = {}) {
    const triggerLabels = {
      on_queue_add: 'Added to Leaving Soon',
      on_delete: 'Deleted',
      on_rule_complete: 'Rule Completed',
      on_error: 'Error',
      on_service_down: 'Service Down'
    };

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Flexerr: ${triggerLabels[trigger] || trigger}`
        }
      }
    ];

    if (data.title) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${data.title}*${data.year ? ` (${data.year})` : ''}`
        },
        accessory: data.poster ? {
          type: 'image',
          image_url: data.poster,
          alt_text: data.title
        } : undefined
      });
    }

    const fields = [];
    if (data.rule) fields.push({ type: 'mrkdwn', text: `*Rule:* ${data.rule}` });
    if (data.action) fields.push({ type: 'mrkdwn', text: `*Action:* ${data.action}` });
    if (data.daysRemaining !== undefined) {
      fields.push({ type: 'mrkdwn', text: `*Days Remaining:* ${data.daysRemaining}` });
    }

    if (fields.length > 0) {
      blocks.push({
        type: 'section',
        fields
      });
    }

    if (data.error) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Error:* ${data.error}` }
      });
    }

    await axios.post(url, { blocks });
  }

  // Gotify push notification
  static async sendGotify(url, trigger, data, settings = {}) {
    const triggerLabels = {
      on_queue_add: 'Added to Leaving Soon',
      on_delete: 'Deleted',
      on_rule_complete: 'Rule Completed',
      on_error: 'Error',
      on_service_down: 'Service Down'
    };

    const priority = trigger === 'on_error' || trigger === 'on_service_down' ? 8 : 5;

    let message = data.title ? `${data.title}${data.year ? ` (${data.year})` : ''}` : '';
    if (data.rule) message += `\nRule: ${data.rule}`;
    if (data.action) message += `\nAction: ${data.action}`;
    if (data.error) message += `\nError: ${data.error}`;

    await axios.post(`${url}/message`, {
      title: `Flexerr: ${triggerLabels[trigger] || trigger}`,
      message,
      priority
    }, {
      headers: {
        'X-Gotify-Key': settings.token
      }
    });
  }

  // Pushover push notification
  static async sendPushover(settings, trigger, data) {
    const triggerLabels = {
      on_queue_add: 'Added to Leaving Soon',
      on_delete: 'Deleted',
      on_rule_complete: 'Rule Completed',
      on_error: 'Error',
      on_service_down: 'Service Down'
    };

    const priority = trigger === 'on_error' || trigger === 'on_service_down' ? 1 : 0;

    let message = data.title ? `${data.title}${data.year ? ` (${data.year})` : ''}` : '';
    if (data.rule) message += `\nRule: ${data.rule}`;
    if (data.action) message += `\nAction: ${data.action}`;
    if (data.error) message += `\nError: ${data.error}`;

    await axios.post('https://api.pushover.net/1/messages.json', {
      token: settings.app_token,
      user: settings.user_key,
      title: `Flexerr: ${triggerLabels[trigger] || trigger}`,
      message,
      priority
    });
  }

  // ntfy push notification
  static async sendNtfy(url, trigger, data, settings = {}) {
    const triggerLabels = {
      on_queue_add: 'Added to Leaving Soon',
      on_delete: 'Deleted',
      on_rule_complete: 'Rule Completed',
      on_error: 'Error',
      on_service_down: 'Service Down'
    };

    const priority = trigger === 'on_error' || trigger === 'on_service_down' ? 'high' : 'default';

    let message = data.title ? `${data.title}${data.year ? ` (${data.year})` : ''}` : '';
    if (data.rule) message += `\nRule: ${data.rule}`;
    if (data.action) message += `\nAction: ${data.action}`;
    if (data.error) message += `\nError: ${data.error}`;

    const headers = {
      'Title': `Flexerr: ${triggerLabels[trigger] || trigger}`,
      'Priority': priority
    };

    if (settings.username && settings.password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${settings.username}:${settings.password}`).toString('base64');
    }

    await axios.post(url, message, { headers });
  }

  // Email notification (requires SMTP settings)
  static async sendEmail(settings, trigger, data) {
    // This would require nodemailer, skipping for now
    // Users can use custom webhooks with email services like SendGrid
    console.log('[Notification] Email not implemented, use custom webhook with email service');
  }

  // Custom webhook (generic POST)
  static async sendCustom(url, trigger, data, settings = {}) {
    const payload = {
      trigger,
      timestamp: new Date().toISOString(),
      ...data
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    if (settings.headers) {
      Object.assign(headers, settings.headers);
    }

    await axios.post(url, payload, { headers });
  }

  // Helper: Notify when item added to watchlist/requested
  static async notifyWatchlistAdd(item, user) {
    await this.notify('on_request', {
      title: item.title,
      year: item.year,
      poster: item.poster_path || item.poster,
      mediaType: item.media_type || item.mediaType,
      user: user.username || user
    });
  }

  // Helper: Notify when item becomes available
  static async notifyAvailable(item, user) {
    await this.notify('on_available', {
      title: item.title,
      year: item.year,
      poster: item.poster_path || item.poster,
      mediaType: item.media_type || item.mediaType,
      user: user?.username || user
    });
  }

  // Helper: Notify when item added to queue
  static async notifyQueueAdd(item, rule) {
    const bufferDays = rule.buffer_days || 15;
    await this.notify('on_queue_add', {
      title: item.title,
      year: item.year,
      poster: item.thumb,
      rule: rule.name,
      action: 'Added to Leaving Soon',
      daysRemaining: bufferDays
    }, rule.id);
  }

  // Helper: Notify when item deleted
  static async notifyDelete(item, rule, action) {
    await this.notify('on_delete', {
      title: item.title,
      year: item.year,
      poster: item.thumb,
      rule: rule.name,
      action
    }, rule.id);
  }

  // Helper: Notify when rule completes
  static async notifyRuleComplete(rule, stats) {
    await this.notify('on_rule_complete', {
      rule: rule.name,
      stats: `Matches: ${stats.matches}, Actions: ${stats.actions}`
    }, rule.id);
  }

  // Helper: Notify on error
  static async notifyError(error, context = {}) {
    await this.notify('on_error', {
      error: error.message || error,
      ...context
    });
  }

  // Helper: Notify when service goes down
  static async notifyServiceDown(service, error) {
    await this.notify('on_service_down', {
      title: `${service} Connection Failed`,
      error: error.message || error
    });
  }
}

module.exports = NotificationService;
