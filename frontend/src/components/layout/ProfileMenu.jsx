import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

function getInitials(username) {
  if (!username) return '?';
  return username.trim().slice(0, 1).toUpperCase();
}

/**
 * Circular avatar fixed top-right on every screen. Opens a menu linking to
 * Settings, Account, and (admins only) the Admin Panel, plus log out.
 */
export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  function handleLogout() {
    setOpen(false);
    logout();
    navigate('/login');
  }

  return (
    <>
      <button
        type="button"
        className="profile-avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open profile menu"
        aria-expanded={open}
      >
        {getInitials(user?.username)}
      </button>

      {open && (
        <>
          <div className="profile-menu-overlay" />
          <div className="profile-menu" ref={menuRef} role="menu">
            {user?.username && <div className="profile-menu-name">{user.username}</div>}
            {user?.role && <div className="profile-menu-role">{user.role}</div>}
            <div className="profile-menu-divider" />
            <button type="button" className="profile-menu-item" onClick={() => go('/settings')}>
              Settings
            </button>
            <button type="button" className="profile-menu-item" onClick={() => go('/account')}>
              Account
            </button>
            {isAdmin && (
              <button type="button" className="profile-menu-item" onClick={() => go('/admin')}>
                Admin Panel
              </button>
            )}
            <div className="profile-menu-divider" />
            <button
              type="button"
              className="profile-menu-item profile-menu-item-muted"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </>
      )}
    </>
  );
}
