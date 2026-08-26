"use client";

import {
  COMMAND_EXECUTION_MODE,
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  VERIFICATION_MODE,
} from "@nox/shared";

import { TASK_LIMITS } from "@/lib/task-input";
import {
  planFieldNames,
  type PlanFieldPrefix,
  type TaskEditCommandRow,
  type TaskEditCriterionRow,
} from "@/lib/verification-fields";

const FIELD_CLASSES =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-teal-400/60 focus:outline-none focus:ring-1 focus:ring-teal-400/40 " +
  "disabled:opacity-60 read-only:opacity-70";

const ROW_CLASSES = "rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-4";

const SMALL_BUTTON_CLASSES =
  "rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 " +
  "transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-60";

export type VerificationPlanRows = {
  criteria: readonly TaskEditCriterionRow[];
  commands: readonly TaskEditCommandRow[];
};

export type VerificationPlanHandlers = {
  updateCriterion: (key: string, patch: Partial<TaskEditCriterionRow>) => void;
  updateCommand: (key: string, patch: Partial<TaskEditCommandRow>) => void;
  toggleProof: (criterionKey: string, commandKey: string) => void;
  addCriterion: () => void;
  removeCriterion: (key: string) => void;
  addCommand: () => void;
  removeCommand: (key: string) => void;
};

/** Etiquette d'une commande dans la liste des preuves possibles. */
function commandLabel(row: TaskEditCommandRow, index: number): string {
  const text = row.command.trim();
  return text === "" ? `Commande ${String(index + 1)} (vide)` : text;
}

/**
 * Toutes les valeurs du plan, en champs caches.
 *
 * Sert aux surfaces qui replient une tache — la revue d'un backlog en affiche
 * vingt. Un champ demonte perdrait sa valeur, et l'enregistrement partirait avec
 * une tache amputee de tout ce que l'utilisateur n'a pas deplie.
 */
function HiddenPlan({ prefix, rows }: { prefix: PlanFieldPrefix; rows: VerificationPlanRows }) {
  const names = planFieldNames(prefix);
  return (
    <>
      {rows.commands.map((row) => (
        <span key={row.key}>
          <input type="hidden" name={names.commandKey} value={row.key} />
          <input type="hidden" name={names.commandText(row.key)} value={row.command} />
          <input type="hidden" name={names.commandMode(row.key)} value={row.executionMode} />
        </span>
      ))}
      {rows.criteria.map((row) => (
        <span key={row.key}>
          <input type="hidden" name={names.criterionKey} value={row.key} />
          <input type="hidden" name={names.criterionText(row.key)} value={row.text} />
          <input type="hidden" name={names.criterionMode(row.key)} value={row.verificationMode} />
          <input
            type="hidden"
            name={names.criterionInstructions(row.key)}
            value={row.humanInstructions}
          />
          {row.commandKeys.map((commandKey) => (
            <input
              key={commandKey}
              type="hidden"
              name={names.criterionCommands(row.key)}
              value={commandKey}
            />
          ))}
        </span>
      ))}
    </>
  );
}

/**
 * Le plan de verification d'une tache, editable.
 *
 * ## Pourquoi un composant partage
 *
 * Parce que l'editeur de tache future et la revue d'un backlog decrivent le
 * **meme** contrat. Deux implementations auraient fini par proposer deux modes
 * differents, deux bornes differentes, ou deux facons de nommer les preuves —
 * et le jour ou elles auraient diverge, personne n'aurait su laquelle faisait
 * autorite.
 *
 * ## Les identites de ligne
 *
 * Chaque ligne porte une cle stable, qui ne vient ni du texte, ni de la
 * position, ni de la base. Supprimer la ligne du milieu ne fait donc pas glisser
 * le contenu des suivantes dans les mauvais champs, et taper dans un critere ne
 * remonte pas le champ.
 *
 * ## Ce composant ne juge pas la coherence du plan
 *
 * Un critere automatise sans preuve reste enregistrable : un brouillon a le
 * droit d'etre incomplet. C'est `Mark ready` qui refuse, une fois, au seul
 * endroit qui fasse autorite. L'ecran se contente de **dire** ce qui manque.
 */
export function VerificationPlanFields({
  prefix,
  rows,
  handlers,
  disabled,
  hidden = false,
}: {
  prefix: PlanFieldPrefix;
  rows: VerificationPlanRows;
  handlers: VerificationPlanHandlers;
  disabled: boolean;
  /** La tache est repliee : les valeurs partent, mais rien ne s'affiche. */
  hidden?: boolean;
}) {
  const names = planFieldNames(prefix);

  if (hidden) {
    return <HiddenPlan prefix={prefix} rows={rows} />;
  }

  const automatedCount = rows.criteria.filter(
    (row) => row.verificationMode === VERIFICATION_MODE.AUTOMATED,
  ).length;
  const humanCount = rows.criteria.length - automatedCount;

  return (
    <>
      <fieldset className="rounded-md border border-zinc-800 px-4 py-4">
        <legend className="px-2 text-sm font-medium text-zinc-200">
          Commandes de validation
        </legend>

        <p className="text-xs leading-relaxed text-zinc-600">
          <span className="text-zinc-400">Agent only</span> : la commande est autorisee a Claude
          Code pendant son travail, et NOX ne la lance jamais.{" "}
          <span className="text-zinc-400">Autonomous</span> : NOX l&apos;executera lui-meme apres
          l&apos;execution, et son resultat pourra prouver un critere. Seule une commande
          autonome peut servir de preuve.
        </p>

        {rows.commands.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Aucune commande enregistree.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {rows.commands.map((row, index) => (
              <li key={row.key} className={ROW_CLASSES}>
                <input type="hidden" name={names.commandKey} value={row.key} />
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
                  <div>
                    <label
                      htmlFor={`${prefix}command-${row.key}`}
                      className="block text-xs font-medium text-zinc-400"
                    >
                      Commande {index + 1}
                    </label>
                    <input
                      id={`${prefix}command-${row.key}`}
                      name={names.commandText(row.key)}
                      type="text"
                      value={row.command}
                      onChange={(event) => {
                        handlers.updateCommand(row.key, { command: event.target.value });
                      }}
                      disabled={disabled}
                      maxLength={TASK_LIMITS.commands.length}
                      autoComplete="off"
                      spellCheck={false}
                      className={`mt-2 font-mono ${FIELD_CLASSES}`}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${prefix}command-mode-${row.key}`}
                      className="block text-xs font-medium text-zinc-400"
                    >
                      Execution
                    </label>
                    <select
                      id={`${prefix}command-mode-${row.key}`}
                      name={names.commandMode(row.key)}
                      value={row.executionMode}
                      onChange={(event) => {
                        handlers.updateCommand(row.key, { executionMode: event.target.value });
                      }}
                      disabled={disabled}
                      className={`mt-2 ${FIELD_CLASSES}`}
                    >
                      <option value={COMMAND_EXECUTION_MODE.AGENT_ONLY}>Agent only</option>
                      <option value={COMMAND_EXECUTION_MODE.AUTONOMOUS}>Autonomous</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        handlers.removeCommand(row.key);
                      }}
                      disabled={disabled}
                      className={SMALL_BUTTON_CLASSES}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={handlers.addCommand}
          disabled={disabled || rows.commands.length >= TASK_LIMITS.commands.count}
          className={`mt-4 ${SMALL_BUTTON_CLASSES}`}
        >
          Add command
        </button>
      </fieldset>

      <fieldset className="rounded-md border border-zinc-800 px-4 py-4">
        <legend className="px-2 text-sm font-medium text-zinc-200">
          Criteres d&apos;acceptation
        </legend>

        <p className="text-xs leading-relaxed text-zinc-600">
          {automatedCount} automatise(s), {humanCount} humain(s). Un critere automatise doit
          nommer la ou les commandes autonomes qui le prouvent : le lien n&apos;est jamais
          deduit du texte. Un critere humain dit ce qu&apos;il faut verifier, et comment.
        </p>

        {rows.criteria.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            Aucun critere. Au moins un est obligatoire pour passer la tache en file.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {rows.criteria.map((row, index) => {
              const automated = row.verificationMode === VERIFICATION_MODE.AUTOMATED;
              return (
                <li key={row.key} className={ROW_CLASSES}>
                  <input type="hidden" name={names.criterionKey} value={row.key} />

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
                    <div>
                      <label
                        htmlFor={`${prefix}criterion-${row.key}`}
                        className="block text-xs font-medium text-zinc-400"
                      >
                        Critere {index + 1}
                      </label>
                      <input
                        id={`${prefix}criterion-${row.key}`}
                        name={names.criterionText(row.key)}
                        type="text"
                        value={row.text}
                        onChange={(event) => {
                          handlers.updateCriterion(row.key, { text: event.target.value });
                        }}
                        disabled={disabled}
                        maxLength={TASK_LIMITS.criteria.length}
                        autoComplete="off"
                        className={`mt-2 ${FIELD_CLASSES}`}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${prefix}criterion-mode-${row.key}`}
                        className="block text-xs font-medium text-zinc-400"
                      >
                        Verification
                      </label>
                      <select
                        id={`${prefix}criterion-mode-${row.key}`}
                        name={names.criterionMode(row.key)}
                        value={row.verificationMode}
                        onChange={(event) => {
                          handlers.updateCriterion(row.key, {
                            verificationMode: event.target.value,
                          });
                        }}
                        disabled={disabled}
                        className={`mt-2 ${FIELD_CLASSES}`}
                      >
                        <option value={VERIFICATION_MODE.HUMAN}>Humain</option>
                        <option value={VERIFICATION_MODE.AUTOMATED}>Automatise</option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => {
                          handlers.removeCriterion(row.key);
                        }}
                        disabled={disabled}
                        className={SMALL_BUTTON_CLASSES}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {automated ? (
                    <div className="mt-4">
                      <p className="text-xs font-medium text-zinc-400">
                        Commandes qui prouvent ce critere
                      </p>
                      {rows.commands.length === 0 ? (
                        <p className="mt-2 text-xs text-amber-300/80">
                          Aucune commande n&apos;est enregistree sur cette tache : ajoutez-en une
                          au-dessus, en mode autonome.
                        </p>
                      ) : (
                        <ul className="mt-2 flex flex-col gap-2">
                          {rows.commands.map((command, commandIndex) => (
                            <li key={command.key} className="flex items-center gap-3">
                              <input
                                id={`${prefix}proof-${row.key}-${command.key}`}
                                type="checkbox"
                                name={names.criterionCommands(row.key)}
                                value={command.key}
                                checked={row.commandKeys.includes(command.key)}
                                onChange={() => {
                                  handlers.toggleProof(row.key, command.key);
                                }}
                                disabled={disabled}
                                className="h-4 w-4 shrink-0 accent-teal-400"
                              />
                              <label
                                htmlFor={`${prefix}proof-${row.key}-${command.key}`}
                                className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-zinc-300"
                              >
                                <span className="min-w-0 flex-1 truncate font-mono">
                                  {commandLabel(command, commandIndex)}
                                </span>
                                {command.executionMode === COMMAND_EXECUTION_MODE.AUTONOMOUS ? (
                                  <span className="text-teal-300/80">Autonomous</span>
                                ) : (
                                  <span className="text-amber-300/80">
                                    Agent only — ne prouve rien
                                  </span>
                                )}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <label
                        htmlFor={`${prefix}criterion-instructions-${row.key}`}
                        className="block text-xs font-medium text-zinc-400"
                      >
                        Instruction de verification humaine
                      </label>
                      <textarea
                        id={`${prefix}criterion-instructions-${row.key}`}
                        name={names.criterionInstructions(row.key)}
                        value={row.humanInstructions}
                        onChange={(event) => {
                          handlers.updateCriterion(row.key, {
                            humanInstructions: event.target.value,
                          });
                        }}
                        readOnly={disabled}
                        rows={2}
                        maxLength={MAX_HUMAN_INSTRUCTIONS_LENGTH}
                        className={`mt-2 resize-y ${FIELD_CLASSES}`}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={handlers.addCriterion}
          disabled={disabled || rows.criteria.length >= TASK_LIMITS.criteria.count}
          className={`mt-4 ${SMALL_BUTTON_CLASSES}`}
        >
          Add criterion
        </button>
      </fieldset>
    </>
  );
}
