import Link from "next/link";

import { taskWorkflowUrl } from "@/lib/guided-workflow-display";

/**
 * Retour au guide, depuis une surface d'execution ou de review.
 *
 * Volontairement minuscule : NOX n'a pas de barre de navigation globale, et
 * TASK-016 n'en introduit pas. Ce lien repond a une seule question — « ou
 * retrouve-t-on la prochaine etape ? » — depuis les pages ou l'utilisateur
 * arrive par une recommandation et voudra repartir vers la suivante.
 */
export function WorkflowLink({ projectId, taskId }: { projectId: string; taskId: string }) {
  return (
    <Link
      href={taskWorkflowUrl(projectId, taskId)}
      className="text-xs text-zinc-500 hover:text-zinc-300"
    >
      Back to task workflow
    </Link>
  );
}
