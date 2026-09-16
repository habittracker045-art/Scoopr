const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/supabaseClient');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // Re-check user status on every request so a disabled account
  // is locked out immediately, even if their token is still valid.
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, email, role, status')
    .eq('id', decoded.id)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'User no longer exists.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This account has been disabled.' });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth };
