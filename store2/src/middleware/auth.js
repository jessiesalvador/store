function requireAuth(req, res, next) {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated. Please log in." });
    }
    next();
  }
  
  function requireSuperAdmin(req, res, next) {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (req.session.role !== "super-admin") {
      return res.status(403).json({ error: "Super admin access required." });
    }
    next();
  }
  
  function requireStoreAdmin(req, res, next) {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!["store-admin", "super-admin"].includes(req.session.role)) {
      return res.status(403).json({ error: "Store admin access required." });
    }
    next();
  }
  
  function requireStoreOwnership(req, res, next) {
    if (req.session.role === "super-admin") return next();
    if (req.session.storeId?.toString() !== req.params.storeId) {
      return res.status(403).json({ error: "You do not have access to this store." });
    }
    next();
  }
  
  module.exports = { requireAuth, requireSuperAdmin, requireStoreAdmin, requireStoreOwnership };