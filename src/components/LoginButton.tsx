import React, { useEffect, useState } from 'react';
import { auth, loginWithGoogle, logout } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export function LoginButton() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Écoute les changements d'état en temps réel (connexion/déconnexion)
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  if (user) {
    return (
      <button 
        className="tb-action-btn" 
        onClick={logout} 
        title="Se déconnecter"
      >
        {user.photoURL && (
          <img 
            src={user.photoURL} 
            alt="Profil" 
            style={{ width: 20, height: 20, borderRadius: '50%' }} 
          />
        )}
        <span className="tb-label">{user.displayName?.split(' ')[0]}</span>
      </button>
    );
  }

  return (
    <button className="tb-primary" onClick={loginWithGoogle}>
      Connexion Google
    </button>
  );
}