import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Change à chaque navigation : l'erreur disparaît quand on change d'écran */
  resetKey: string;
}

/** Un écran qui plante n'emporte pas toute l'appli : les notes restent sur l'appareil. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur dans Notes Maths', error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Oups, cet écran a rencontré un problème</h1>
        <p>Tes notes sont enregistrées sur l’appareil : rien n’est perdu.</p>
        <pre>{this.state.error.message}</pre>
        <div className="row">
          <button className="primary" onClick={() => window.location.reload()}>
            Recharger l’appli
          </button>
          <button
            onClick={() => {
              window.location.hash = '#/';
              this.setState({ error: null });
            }}
          >
            Retour à la bibliothèque
          </button>
        </div>
      </div>
    );
  }
}
