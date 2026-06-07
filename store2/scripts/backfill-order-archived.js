require("dotenv").config();

const { db } = require("../src/config/firebase");

async function backfillOrderArchived() {
  const snap = await db.collection("orders").get();
  let batch = db.batch();
  let pending = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    if (doc.data().archived !== undefined) continue;

    batch.update(doc.ref, { archived: false });
    pending += 1;
    updated += 1;

    if (pending >= 450) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending) await batch.commit();
  console.log(`Backfilled ${updated} orders with archived=false.`);
  return updated;
}

if (require.main === module) {
  backfillOrderArchived().catch((err) => {
    console.error("Order archived backfill failed:", err);
    process.exit(1);
  });
}

module.exports = { backfillOrderArchived };
