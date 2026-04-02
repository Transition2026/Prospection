-- CreateTable
CREATE TABLE "EntrepriseExportee" (
    "id" SERIAL NOT NULL,
    "siren" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "exported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntrepriseExportee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntrepriseExportee_siren_key" ON "EntrepriseExportee"("siren");
