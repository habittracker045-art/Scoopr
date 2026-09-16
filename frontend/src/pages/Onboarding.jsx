import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { updateSchedule } from '../api/scheduleApi';
import { Button, Card, Pill } from '../components/ui';
import { FEED_TOPICS } from '../config/topics';

// Same option lists Settings.jsx uses (mirrors
// routes/utils/validateSchedule.js's VALID_FRESHNESS_WINDOWS /
// VALID_UPDATE_TYPES) — kept as a second small, stable copy rather than
// importing from Settings.jsx, matching how Settings.jsx itself already
// keeps its own copy instead of importing from the route file. If this
// list ever needs to change, both call sites need the same one-line edit.
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

// FEED_TOPICS includes the frontend-only 'all' pseudo-topic — not a real
// topic to onboard someone onto, same exclusion Settings.jsx applies.
const SELECTABLE_TOPICS = FEED_TOPICS.filter((t) => t.key !== 'all');

// Used by "Skip for now" when the user hasn't picked any topics yet — a
// schedule_settings row still needs *some* topics to save successfully
// (the backend's validateScheduleInput requires a non-empty array), and
// this keeps Settings from opening to a totally empty topic list on the
// user's first real visit there. General News is the broadest, safest
// single default.
const DEFAULT_SKIP_TOPICS = ['general'];

const STEPS = [
  { key: 'topics', title: 'What do you care about?', subtitle: 'Pick as many topics as you like.' },
  {
    key: 'freshness',
    title: 'How fresh should it be?',
    subtitle: 'How far back should Scoopr look when it pulls in content?'
  },
  {
    key: 'updateType',
    title: 'News, events, or both?',
    subtitle: 'What kind of updates do you want to see?'
  }
];

/**
 * First-run onboarding (Phase 4, Prompt 7) — shown once, right after
 * signup, before the user ever reaches the main app. A short 3-step flow
 * (topics -> freshness window -> update type) that saves straight into
 * the same schedule_settings row Settings.jsx reads/writes
 * (GET/PUT /api/schedule, Phase 3, Prompt 1) — so by the time the user
 * lands on Settings for the first time, it's pre-filled instead of empty,
 * per the spec. The schedule is saved with `enabled: false`: onboarding
 * sets the user's *preferences*, it does not itself turn on
 * auto-generate — that's still an explicit opt-in on Settings, per the
 * original toggle-ON/OFF spec.
 *
 * Reuses components/ui/* (Card, Pill, Button) exclusively, matching every
 * other screen — nothing new was added to components/ui/ for this.
 *
 * Routing: only reachable while signed in and only while
 * `onboardingComplete` (AuthContext, derived from GET /api/schedule's
 * `hasSchedule`) is `false` — see App.jsx's <OnboardingRoute>. Completing
 * (or skipping) calls `markOnboardingComplete()` so the router stops
 * redirecting here immediately, without waiting on a second
 * GET /api/schedule round trip.
 */
export default function Onboarding() {
  const { token, markOnboardingComplete } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [topics, setTopics] = useState([]);
  const [freshnessWindow, setFreshnessWindow] = useState('24h');
  const [updateType, setUpdateType] = useState('news');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isFirstStep = step === 0;
  const isLastStep = step === STEPS.length - 1;
  const current = STEPS[step];

  function toggleTopic(key) {
    setTopics((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
    setError(null);
  }

  function handleBack() {
    if (isFirstStep) return;
    setError(null);
    setStep((s) => s - 1);
  }

  function handleContinue() {
    if (current.key === 'topics' && topics.length === 0) {
      setError('Select at least one topic to continue.');
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  }

  // Shared by both "Finish setup" and "Skip for now" — the only
  // difference is which topics get saved (the user's picks, or a sane
  // default when they haven't picked any). Either way this always saves
  // a real, valid schedule_settings row (enabled: false, 08:00 default
  // time — same defaults routes/schedule.js's DEFAULT_SCHEDULE already
  // uses for a user with no row), which is what makes onboarding "count"
  // as done: `hasSchedule` flips to true the moment this succeeds.
  async function finish(finalTopics) {
    setSaving(true);
    setError(null);
    try {
      await updateSchedule({
        token,
        enabled: false,
        scheduledTime: '08:00',
        topics: finalTopics,
        freshnessWindow,
        updateType
      });
      markOnboardingComplete();
      navigate('/feed', { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong saving your preferences.');
    } finally {
      setSaving(false);
    }
  }

  function handleFinish() {
    if (topics.length === 0) {
      setError('Select at least one topic to continue.');
      setStep(0);
      return;
    }
    finish(topics);
  }

  function handleSkip() {
    finish(topics.length > 0 ? topics : DEFAULT_SKIP_TOPICS);
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-top">
          <div className="onboarding-wordmark">Scoopr</div>
          <button type="button" className="onboarding-skip" onClick={handleSkip} disabled={saving}>
            Skip for now
          </button>
        </div>

        <div className="onboarding-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.key} className={`onboarding-dot ${i === step ? 'onboarding-dot-active' : ''}`} />
          ))}
        </div>

        <h1 className="onboarding-title">{current.title}</h1>
        <p className="onboarding-subtitle">{current.subtitle}</p>

        <Card className="onboarding-step-card">
          {current.key === 'topics' && (
            <div className="onboarding-pill-group">
              {SELECTABLE_TOPICS.map((t) => (
                <Pill key={t.key} active={topics.includes(t.key)} onClick={() => toggleTopic(t.key)}>
                  {t.label}
                </Pill>
              ))}
            </div>
          )}

          {current.key === 'freshness' && (
            <div className="onboarding-pill-group">
              {FRESHNESS_OPTIONS.map((o) => (
                <Pill
                  key={o.key}
                  active={freshnessWindow === o.key}
                  onClick={() => {
                    setFreshnessWindow(o.key);
                    setError(null);
                  }}
                >
                  {o.label}
                </Pill>
              ))}
            </div>
          )}

          {current.key === 'updateType' && (
            <div className="onboarding-pill-group">
              {UPDATE_TYPE_OPTIONS.map((o) => (
                <Pill
                  key={o.key}
                  active={updateType === o.key}
                  onClick={() => {
                    setUpdateType(o.key);
                    setError(null);
                  }}
                >
                  {o.label}
                </Pill>
              ))}
            </div>
          )}
        </Card>

        {error && <p className="onboarding-error">{error}</p>}

        <div className="onboarding-actions">
          {!isFirstStep && (
            <Button variant="secondary" onClick={handleBack} disabled={saving}>
              Back
            </Button>
          )}
          {isLastStep ? (
            <Button onClick={handleFinish} disabled={saving} fullWidth={isFirstStep}>
              {saving ? 'Saving…' : 'Finish setup'}
            </Button>
          ) : (
            <Button onClick={handleContinue} fullWidth={isFirstStep}>
              Continue
            </Button>
          )}
        </div>

        <p className="onboarding-hint">
          You can change any of this later in Settings — auto-generate itself starts off
          until you turn it on there.
        </p>
      </div>
    </div>
  );
}
