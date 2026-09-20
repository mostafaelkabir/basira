import { useEffect, useState } from 'react'
import { notify } from '../../components/Notice'
import { getTodayCheckin, saveMorningCheckin, saveEveningCheckin } from '../../api'
import AIPolishButton from '../../components/AIPolishButton'
import MicButton from '../../components/MicButton'

const MOOD_OPTS = [
  { val: 1, emoji: '😔', label: 'Rough' },
  { val: 2, emoji: '😐', label: 'Okay' },
  { val: 3, emoji: '🙂', label: 'Good' },
  { val: 4, emoji: '😊', label: 'Great' },
  { val: 5, emoji: '🌟', label: 'Amazing' },
]

// Optional daily reflection (morning intention / evening reflection). Rendered in
// the Review surface — no longer a permanent Today section.
export function DailyCheckinCard({ onCheckinSaved }) {
  const hour = new Date().getHours()
  const isEvening = hour >= 17
  const [checkin, setCheckin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const [energy, setEnergy] = useState(3)
  const [intention, setIntention] = useState('')

  const [mood, setMood] = useState(3)
  const [rating, setRating] = useState(3)
  const [reflection, setReflection] = useState('')

  useEffect(() => {
    getTodayCheckin().then(c => { setCheckin(c); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return null

  const morningDone = checkin?.morning_energy != null
  const eveningDone = checkin?.evening_mood != null

  if (dismissed) return null
  if (!isEvening && morningDone) return null
  if (isEvening && eveningDone) return null

  async function handleMorning(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await saveMorningCheckin({ energy, intention })
      setCheckin(updated)
      onCheckinSaved?.(updated)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  async function handleEvening(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await saveEveningCheckin({ mood, rating, reflection })
      setCheckin(updated)
      onCheckinSaved?.(updated)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  if (!isEvening) {
    return (
      <div className="bg-gradient-to-br from-forest to-brand rounded-2xl p-5 text-white shadow-md">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Morning Check-in ☀️</p>
            <h3 className="text-lg font-bold">What kind of day do you want?</h3>
          </div>
          <button onClick={() => setDismissed(true)} className="text-white/40 hover:text-white/70 text-lg leading-none mt-0.5">✕</button>
        </div>

        <form onSubmit={handleMorning} className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-white/70 mb-2">Energy level</p>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(v => (
                <button key={v} type="button" onClick={() => setEnergy(v)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${
                    energy === v
                      ? 'bg-surface text-accent border-white shadow-sm'
                      : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                  }`}>
                  {v}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-white/40 mt-1 px-1">
              <span>Low</span><span>High</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-white/70">Intention</p>
              <div className="flex items-center gap-1">
                <AIPolishButton value={intention} onChange={setIntention} context="intention"
                  className="[&_button]:!bg-white/10 [&_button]:!border-white/20 [&_button]:!text-white/70 [&_button:hover]:!bg-white/20" />
                <MicButton value={intention} onChange={setIntention}
                  className="!text-white/60 hover:!text-white hover:!bg-white/10 !border-transparent" />
              </div>
            </div>
            <input
              value={intention}
              onChange={e => setIntention(e.target.value)}
              placeholder="What would make today great?"
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-colors"
            />
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-surface text-accent font-bold py-2.5 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-60">
            {saving ? 'Saving…' : 'Start My Day →'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-forest to-forest rounded-2xl p-5 text-white shadow-md">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Evening Reflection 🌙</p>
          <h3 className="text-lg font-bold">How was today?</h3>
        </div>
        <button onClick={() => setDismissed(true)} className="text-white/40 hover:text-white/70 text-lg leading-none mt-0.5">✕</button>
      </div>

      <form onSubmit={handleEvening} className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-white/70 mb-2">How do you feel?</p>
          <div className="flex gap-2">
            {MOOD_OPTS.map(o => (
              <button key={o.val} type="button" onClick={() => setMood(o.val)}
                className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all border ${
                  mood === o.val
                    ? 'bg-surface border-white shadow-sm'
                    : 'bg-white/10 border-white/20 hover:bg-white/20'
                }`}>
                <span className="text-lg">{o.emoji}</span>
                <span className={`text-[9px] font-semibold mt-0.5 ${mood === o.val ? 'text-accent' : 'text-white/50'}`}>{o.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-white/70 mb-2">Rate the day</p>
          <div className="flex gap-2">
            {[1,2,3,4,5].map(v => (
              <button key={v} type="button" onClick={() => setRating(v)}
                className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${
                  rating === v
                    ? 'bg-highlight text-on-gold border-highlight shadow-sm'
                    : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                }`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-white/40 mt-1 px-1">
            <span>Tough</span><span>Excellent</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-white/70">One-line reflection</p>
            <div className="flex items-center gap-1">
              <AIPolishButton value={reflection} onChange={setReflection} context="reflection"
                className="[&_button]:!bg-white/10 [&_button]:!border-white/20 [&_button]:!text-white/70 [&_button:hover]:!bg-white/20" />
              <MicButton value={reflection} onChange={setReflection}
                className="!text-white/60 hover:!text-white hover:!bg-white/10 !border-transparent" />
            </div>
          </div>
          <input
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            placeholder="What stood out today?"
            className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-colors"
          />
        </div>

        <button type="submit" disabled={saving}
          className="w-full bg-highlight text-on-gold font-bold py-2.5 rounded-xl text-sm hover:bg-gold-300 transition-colors disabled:opacity-60">
          {saving ? 'Saving…' : 'Close the Day ✦'}
        </button>
      </form>
    </div>
  )
}
