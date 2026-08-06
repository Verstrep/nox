# TASK-001 — Tester la gestion des tâches NOX

## Objectif

Vérifier que NOX peut créer une tâche structurée et générer son document Markdown.

## Contexte

TASK-006 et TASK-007 viennent d’être développées.

## Documents obligatoires

- `CLAUDE.md`
- `docs/V1_SCOPE.md`
- `docs/ARCHITECTURE.md`

## Critères d'acceptation

- [ ] La tâche apparaît dans le backlog
- [ ] Le fichier Markdown est créé
- [ ] Le statut peut passer de DRAFT à READY

## Commandes de validation

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

## Hors périmètre

Ne pas lancer Claude Code.

## Règles d'exécution

- Implémenter uniquement cette tâche.
- Ne commencer aucune autre tâche.
- Ne créer aucun commit ni push sans demande explicite.
