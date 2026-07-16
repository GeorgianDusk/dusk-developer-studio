import { Component, type ErrorInfo, type ReactNode } from "react";
import { STUDIO_RELEASE_LABEL } from "../release";
import { ExternalLink } from "./StudioUi";

interface Props { children: ReactNode; }
interface State { failed: boolean; }

export class StudioErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    console.error("Developer Studio route render failed.");
  }

  private recover = () => {
    window.location.hash = "overview";
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-error-boundary" role="alert" aria-live="assertive">
      <span className="section-kicker">Recoverable Studio error</span>
      <h1>This route could not be shown safely.</h1>
      <p>No completion evidence was recorded. Return to the path chooser, or reload this exact release and try again.</p>
      <div className="button-row">
        <button className="primary-button" type="button" onClick={this.recover}>Return to paths</button>
        <button className="secondary-button" type="button" onClick={() => window.location.reload()}>Reload Studio</button>
        <ExternalLink href="https://discord.com/invite/dusk-official">Report the issue</ExternalLink>
      </div>
      <small>{STUDIO_RELEASE_LABEL}</small>
    </main>;
  }
}
