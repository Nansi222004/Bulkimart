import React from 'react';
import { useUser } from '../context/UserContext';

/**
 * Title bar for pages opened from the Account menu (Help & Support, Privacy Policy).
 * Back steps back when the page was opened from Account, otherwise (shared link,
 * refresh, typed URL) it goes to Account.
 */
const AccountPageHeader = ({ title }) => {
  const { setActiveNav } = useUser();
  const goBack = () => {
    if (window.history.state?.fromNav === 'account') window.history.back();
    else setActiveNav('account');
  };
  return (
    <div className="account-page-header">
      <button type="button" onClick={goBack} aria-label="Back">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>
      <h1>{title}</h1>
    </div>
  );
};

export default AccountPageHeader;
