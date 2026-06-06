import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from './api'
import Modal from './components/Modal'

export default function SettingsModal({ onClose }) {
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings).catch(err => alert(err.message))
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateSettings({
        reminder_enabled: settings.reminder_enabled === 'true',
        reminder_time: settings.reminder_time,
      })
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      {!settings ? (
        <p className="text-sand-400 text-sm py-4">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-sand-700 mb-3">Habit Reminders</h3>
            <p className="text-xs text-sand-400 mb-3">
              Get a macOS notification if you haven't checked in on your habits by the set time.
            </p>

            <label className="flex items-center gap-2.5 text-sm text-sand-700 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={settings.reminder_enabled === 'true'}
                onChange={e => setSettings({ ...settings, reminder_enabled: e.target.checked ? 'true' : 'false' })}
                className="w-4 h-4 accent-teal-600"
              />
              Enable daily reminder
            </label>

            <div className={settings.reminder_enabled === 'true' ? '' : 'opacity-40 pointer-events-none'}>
              <label className="text-sm font-medium text-sand-700">Reminder time</label>
              <input
                type="time"
                value={settings.reminder_time}
                onChange={e => setSettings({ ...settings, reminder_time: e.target.value })}
                className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              />
              <p className="text-xs text-sand-400 mt-1">
                If you've already checked in on all habits, no notification is sent.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-sand-600 hover:text-sand-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-40">
              Save
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
