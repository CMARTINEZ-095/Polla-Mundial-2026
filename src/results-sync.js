async function syncResultsOnce() {
  return {
    ok: false,
    skipped: true,
    message: "Sincronizacion automatica desactivada. Los resultados se actualizan manualmente desde el panel admin.",
    updates: []
  };
}

function startResultsSync() {
  console.log("Sincronizacion automatica desactivada. Modo manual admin activo.");
}

module.exports = { syncResultsOnce, startResultsSync };