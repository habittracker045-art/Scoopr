import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSchedule, updateSchedule, generateNow } from '../api/scheduleApi';
import { Button, Card, Input, Pill, Spinner, Toggle } from '../components/ui';
import { FEED_TOPICS } from '../config/topics';

// Mirror routes/utils/validateSchedule.js's VALID_FRESHNESS_WINDOWS /
// VALID_UPDATE_TYPES (small, stable lists, kept in sync by hand — same
// convention config/topics.js's own comment describes for its backend
// counterpart).
const FRESHNESS_OPTIONS = [
  { key: '6h', label: '6 Hours' },
  { key: '24h', label: '24 Hours' },
  { key: '3d', label: '3 Days' }
];

const UPDATE_TYPE_OPTIONS = [
  { key: 'news', label: 'News' },
  { key: 'events', label: 'Events' },
  { key: 'both', label: 'Both' }
];

// FEED_TOPICS includes the frontend-only 'all' pseudo-topic (used by
// Feed/History's single-select filters) — not a real topic to schedule
// generation for, so it's excluded from this multi-select.
const SELECTABLE_TOPICS = FEED_TOPICS.filter((t) => t.key !== 'all');

/**
 * Settings tab (Phase 4, Prompt 5) — lives behind the profile menu, not
 * the main floating nav (see ProfileMenu.jsx / App.jsx's /settings
 * route, both already wired since Prompt 1). Two independent sections:
 *
 *  1. The Auto-Generate schedule form (GET/PUT /api/schedule) — toggle,
 *     time picker, topic multi-select, freshness window, update type.
 *     All five fields are sent together on every Save, since the
 *     backend's validator (validateScheduleInput) requires all of them
 *     regardless of `enabled` — there's no partial-update path.
 *  2. "Generate Now" (POST /api/pipeline/generate-now) — runs the
 *     pipeline immediately using whatever's currently *saved*, which is
 *     why its hint tells the user to Save first if they just changed
 *     topics. Kept as its own card/section since it's an action, not a
 *     form field, and doesn't participate in the "Saved." confirmation
 *     below the Save button.
 *
 * Every control here is one of components/ui/* (Card, Input, Pill,
 * Toggle, Button, Spinner) — nothing new was added to components/ui/,
 * per the "reuse the Pill selector pattern" instruction for both the
 * topic multi-select and the freshness/update-type single-selects.
 */
export default function Settings() {
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [enabled, setEnabled] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('08:00');
  const [topics, setTopics] = useState([]);
  const [freshnessWindow, setFreshnessWindow] = useState('24h');
  const [updateType, setUpdateType] = useState('news');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState(null);
  const [generateError, setGenerateError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getSchedule({ token });
      const s = data.schedule;
      setEnabled(Boolean(s.enabled));
      setScheduledTime(s.scheduledTime || '08:00');
      setTopics(s.topics || []);
      setFreshnessWindow(s.freshnessWindow || '24h');
      setUpdateType(s.updateType || 'news');
    } catch (err) {
      setLoadError(err.message || 'Something went wrong loading your settings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Any edit invalidates the previous "Saved." confirmation — it should
  // only ever describe the form's *current* state.
  function clearSavedState() {
    setSaved(false);
    setSaveError(null);
  }

  function toggleTopic(key) {
    setTopics((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
    clearSavedState();
  }

  async function handleSave() {
    clearSavedState();

    // Client-side check for the one thing a user is likely to actually
    // hit (forgetting to pick a topic) so it's instant, rather than a
    // round trip to hear back validateScheduleInput's identical message.
    if (topics.length === 0) {
      setSaveError('Select at least one topic.');
      return;
    }

    setSaving(true);
    try {
      const data = await updateSchedule({
        token,
        enabled,
        scheduledTime,
        topics,
        freshnessWindow,
        updateType
      });
      const s = data.schedule;
      setEnabled(Boolean(s.enabled));
      setScheduledTime(s.scheduledTime);
      setTopics(s.topics || []);
      setFreshnessWindow(s.freshnessWindow);
      setUpdateType(s.updateType);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Something went wrong saving your settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateNow() {
    setGenerateError(null);
    setGenerateMessage(null);
    setGenerating(true);
    try {
      const data = await generateNow({ token });
      const results = data.results || [];
      const succeeded = results.filter((r) => r.ok).length;
      setGenerateMessage(
        results.length === 0
          ? 'Nothing to generate.'
          : `Generated fresh cards for ${succeeded}/${results.length} topic${
              results.length === 1 ? '' : 's'
            }. Check the Feed.`
      );
    } catch (err) {
      setGenerateError(err.message || 'Something went wrong generating now.');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <h1 className="page-heading">Settings</h1>
        <div className="settings-loading">
          <Spinner size={24} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="settings-page">
        <h1 className="page-heading">Settings</h1>
        <div className="feed-error">
          <p>{loadError}</p>
          <button type="button" className="feed-retry-btn" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1 className="page-heading">Settings</h1>

      <Card className="settings-section">
        <div className="settings-row">
          <div>
            <p className="settings-row-label">Auto-Generate</p>
            <p className="settings-row-hint">
              {enabled ? 'Enabled — runs at the scheduled time below.' : 'Disabled.'}
            </p>
          </div>
          <Toggle
            checked={enabled}
            onChange={(v) => {
              setEnabled(v);
              clearSavedState();
            }}
          />
        </div>
      </Card>

      <Card className="settings-section">
        <Input
          label="Scheduled Time"
          type="time"
          value={scheduledTime}
          onChange={(e) => {
            setScheduledTime(e.target.value);
            clearSavedState();
          }}
        />
      </Card>

      <Card className="settings-section">
        <p className="ui-label settings-section-label">Topics</p>
        <div className="settings-pill-group">
          {SELECTABLE_TOPICS.map((t) => (
            <Pill key={t.key} active={topics.includes(t.key)} onClick={() => toggleTopic(t.key)}>
              {t.label}
            </Pill>
          ))}
        </div>
      </Card>

      <Card className="settings-section">
        <p className="ui-label settings-section-label">Freshness Window</p>
        <div className="settings-pill-group">
          {FRESHNESS_OPTIONS.map((o) => (
            <Pill
              key={o.key}
              active={freshnessWindow === o.key}
              onClick={() => {
                setFreshnessWindow(o.key);
                clearSavedState();
              }}
            >
              {o.label}
            </Pill>
          ))}
        </div>
      </Card>

      <Card className="settings-section">
        <p className="ui-label settings-section-label">Update Type</p>
        <div className="settings-pill-group">
          {UPDATE_TYPE_OPTIONS.map((o) => (
            <Pill
              key={o.key}
              active={updateType === o.key}
              onClick={() => {
                setUpdateType(o.key);
                clearSavedState();
              }}
            >
              {o.label}
            </Pill>
          ))}
        </div>
      </Card>

      <div className="settings-save-block">
        {saveError && <p className="settings-status settings-status-error">{saveError}</p>}
        {saved && !saveError && <p className="settings-status settings-status-ok">Saved.</p>}
        <Button onClick={handleSave} disabled={saving} fullWidth>
          {saving ? <Spinner size={16} /> : 'Save Changes'}
        </Button>
      </div>

      <Card className="settings-section settings-generate">
        <p className="settings-row-label">Generate Now</p>
        <p className="settings-row-hint">
          Runs a batch immediately using your saved topics and settings above — save
          first if you just changed them.
        </p>
        {generateError && <p className="settings-status settings-status-error">{generateError}</p>}
        {generateMessage && !generateError && (
          <p className="settings-status settings-status-ok">{generateMessage}</p>
        )}
        <Button variant="secondary" onClick={handleGenerateNow} disabled={generating} fullWidth>
          {generating ? <Spinner size={16} /> : 'Generate Now'}
        </Button>
      </Card>
    </div>
  );
}
