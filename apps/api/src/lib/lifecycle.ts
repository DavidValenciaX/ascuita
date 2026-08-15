export type LifecycleState = 'starting' | 'ready' | 'draining' | 'stopped';

export class ServerLifecycle {
  private currentState: LifecycleState = 'starting';

  get state() {
    return this.currentState;
  }

  markReady() {
    if (this.currentState === 'starting') {
      this.currentState = 'ready';
    }
  }

  beginShutdown() {
    if (this.currentState !== 'stopped') {
      this.currentState = 'draining';
    }
  }

  markStopped() {
    this.currentState = 'stopped';
  }

  isReady() {
    return this.currentState === 'ready';
  }
}
