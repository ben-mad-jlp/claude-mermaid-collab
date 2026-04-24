/**
 * NavMenu — logo display only (no dropdown menu).
 * Renders the Collab logo as a non-interactive image.
 * Used in the top-left of every route's header.
 */

import React from 'react';

export const NavMenu: React.FC = () => {
  return (
    <div className="p-0.5">
      <img src="/logo.png" alt="Collab" className="w-7 h-7" />
    </div>
  );
};
