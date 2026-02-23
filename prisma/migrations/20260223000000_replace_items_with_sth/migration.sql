-- DropTable
DROP TABLE IF EXISTS "Item";

-- CreateTable
CREATE TABLE "sths" (
    "id" SERIAL NOT NULL,
    "log_id" TEXT NOT NULL,
    "tree_size" BIGINT NOT NULL,
    "root_hash" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "stored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sths_log_id_stored_at_idx" ON "sths"("log_id", "stored_at" DESC);

-- CreateIndex
CREATE INDEX "sths_log_id_tree_size_idx" ON "sths"("log_id", "tree_size");
