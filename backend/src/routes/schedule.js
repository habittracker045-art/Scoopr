const express = require('express');
const supabase = require('../config/supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { validateScheduleInput } = require('../utils/validateSchedule');

const router = express.Router();

const DEFAULT_SCHEDULE = {
  enabled: false,
  scheduledTime: '08:00',
  topics: [],
  freshnessWindow: '24h',
  updateType: 'news',
  timezone: 'UTC'
};

// Maps a schedule_settings row (snake_case, as stored) to the camelCase
// shape the API returns.
function toApiShape(row) {
  return {
    enabled: row.enabled,
    scheduledTime: row.scheduled_time,
    topics: row.topics || [],
    freshnessWindow: row.freshness_window,
    updateType: row.update_type,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// GET /api/schedule — the current user's schedule settings, or sensible
// defaults (enabled: false, etc.) if they don't have a row yet. A missing
// row is NOT an error — it just means "not scheduled".
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('schedule_settings')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) throw error;

    if (!row) {
      return res.json({ schedule: { ...DEFAULT_SCHEDULE, createdAt: null, updatedAt: null }, hasSchedule: false });
    }

    return res.json({ schedule: toApiShape(row), hasSchedule: true });
  } catch (err) {
    console.error('GET /api/schedule error:', err.message);
    return res.status(500).json({ error: 'Something went wrong loading your schedule settings.' });
  }
});

// PUT /api/schedule — creates or updates (upsert) the current user's
// schedule settings. Validates input before anything reaches Supabase.
router.put('/', requireAuth, async (req, res) => {
  const result = validateScheduleInput(req.body);

  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  const { enabled, scheduledTime, topics, freshnessWindow, updateType } = result.value;

  try {
    const { data: row, error } = await supabase
      .from('schedule_settings')
      .upsert(
        {
          user_id: req.user.id,
          enabled,
          scheduled_time: scheduledTime,
          topics,
          freshness_window: freshnessWindow,
          update_type: updateType
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();

    if (error) throw error;

    return res.json({ schedule: toApiShape(row) });
  } catch (err) {
    console.error('PUT /api/schedule error:', err.message);
    return res.status(500).json({ error: 'Something went wrong saving your schedule settings.' });
  }
});

module.exports = router;
