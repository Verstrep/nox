-- Dependances explicites entre taches.
--
-- Additive : aucune table existante n'est modifiee, aucune donnee n'est lue
-- ni reecrite. Un projet deja en base traverse cette migration sans qu'aucune
-- dependance ne soit creee — le graphe part vide, et il se remplit a la main.

CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Une seule arete entre deux taches : la deuxieme tentative est un double-clic,
-- pas une erreur.
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- Les dependants d'une tache se lisent aussi souvent que ses dependances :
-- la page de la tache montre les deux sens, et la suppression interroge celui-ci.
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");
