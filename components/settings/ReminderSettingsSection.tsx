'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { normalizeTimes, type ReminderSettings, type TimeOfDay } from '@/lib/reminders';
import { remindersRepository } from '@/lib/storage';
import { toStorageErrorMessage } from '@/lib/storage/errors';

/**
 * Configurações → Lembretes: whether and when to remind again about something not marked as
 * done. Each person picks their own times; the defaults are only a starting point.
 */
export function ReminderSettingsSection() {
  const { showToast } = useToast();
  const [saved, setSaved] = useState<ReminderSettings | null>(null);
  const [draft, setDraft] = useState<ReminderSettings | null>(null);
  const [newTime, setNewTime] = useState<TimeOfDay>('20:00');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    remindersRepository
      .getSnapshot()
      .then(({ settings }) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch((err) => setError(toStorageErrorMessage(err, 'Não foi possível carregar.')));
  }, []);

  const dirty =
    saved !== null &&
    draft !== null &&
    (saved.repeatEnabled !== draft.repeatEnabled || saved.repeatTimes.join() !== draft.repeatTimes.join());

  function addTime() {
    if (!draft || !newTime) return;
    setDraft({ ...draft, repeatTimes: normalizeTimes([...draft.repeatTimes, newTime]) });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await remindersRepository.saveSettings(draft);
      setSaved(draft);
      showToast('Horários salvos.');
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar.'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    // An editor with its own "Salvar": leaving with changes asks first (BottomSheet).
    <section className="flex flex-col gap-3 px-4" data-edit-scope data-edit-dirty={Boolean(dirty)}>
      <h2 className="text-muted text-sm font-semibold">Lembretes</h2>
      <div className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm">
        {error ? (
          <p className="text-danger text-sm">{error}</p>
        ) : !draft ? (
          <p className="text-muted text-sm">Carregando…</p>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">Lembrar de novo até marcar feito</p>
                <p className="text-muted mt-0.5 text-xs">
                  Sem “Realizado”, avisa de novo nestes horários.
                </p>
              </div>
              <Switch
                checked={draft.repeatEnabled}
                onChange={(repeatEnabled) => setDraft({ ...draft, repeatEnabled })}
                label="Lembrar de novo até marcar feito"
              />
            </div>

            <div className={`flex flex-col gap-2 ${draft.repeatEnabled ? '' : 'opacity-50'}`}>
              <p className="text-foreground text-sm font-medium">Horários para lembrar de novo</p>
              {draft.repeatTimes.length === 0 ? (
                <p className="text-muted text-xs">Nenhum horário: só o aviso no horário do lembrete.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {draft.repeatTimes.map((time) => (
                    <span
                      key={time}
                      className="border-border bg-background text-foreground flex items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm font-medium tabular-nums"
                    >
                      {time}
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, repeatTimes: draft.repeatTimes.filter((t) => t !== time) })
                        }
                        aria-label={`Tirar ${time}`}
                        disabled={!draft.repeatEnabled}
                        className="text-muted hover:text-danger flex h-8 w-8 items-center justify-center rounded-full"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  aria-label="Novo horário"
                  disabled={!draft.repeatEnabled}
                  className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
                />
                <button
                  type="button"
                  onClick={addTime}
                  disabled={!draft.repeatEnabled || draft.repeatTimes.includes(newTime)}
                  className="border-border text-foreground flex min-h-[44px] items-center gap-1 rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Adicionar
                </button>
              </div>
              <p className="text-muted text-xs">
                Tarefas do dia avisam nos horários de cada uma.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              data-edit-save
              className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar horários'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
