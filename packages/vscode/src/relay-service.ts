import * as crypto from 'crypto';
import {
  Checkpoint,
  Handoff,
  DefaultGitProvider,
  LocalCheckpointStore,
  LocalHandoffStore,
  WakeupGenerator,
  ResumeReconciler,
  StaleDetector,
  HandoffFreshness,
} from '@claude-relay/core';

/**
 * One RelayService instance is scoped to a single resolved workspace folder
 * path — callers must resolve the target folder first (see
 * workspace-resolver.ts) so multi-root workspaces never write to the wrong
 * project.
 */
export class RelayService {
  private readonly gitProvider: DefaultGitProvider;
  private readonly checkpointStore: LocalCheckpointStore;
  private readonly handoffStore: LocalHandoffStore;

  constructor(private readonly workspacePath: string) {
    this.gitProvider = new DefaultGitProvider(workspacePath);
    this.checkpointStore = new LocalCheckpointStore(workspacePath);
    this.handoffStore = new LocalHandoffStore(workspacePath);
  }

  async createCheckpoint(reason: string = 'manual'): Promise<Checkpoint> {
    const git = await this.gitProvider.getSnapshot();
    const checkpoint: Checkpoint = {
      schemaVersion: '1.0',
      id: crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      type: 'recovery',
      reason,
      workspace: { path: this.workspacePath },
      git,
    };
    await this.checkpointStore.save(checkpoint);
    return checkpoint;
  }

  async createHandoff(objective: string, nextAction: string, reason: string = 'manual'): Promise<Handoff> {
    const git = await this.gitProvider.getSnapshot();
    const semantic = {
      objective,
      completed: [] as string[],
      currentWork: objective,
      decisions: [] as string[],
      rejectedApproaches: [] as string[],
      failures: [] as string[],
      constraints: [] as string[],
      importantFiles: [] as string[],
      blockers: [] as string[],
      nextAction,
      doNotRepeat: [] as string[],
      verifyOnResume: [] as string[],
    };
    const handoff: Handoff = {
      schemaVersion: '1.0',
      id: crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      reason,
      workspace: { path: this.workspacePath },
      git,
      semantic,
      integrity: { hash: '' }, // computed and overwritten by the store on save
    };
    await this.handoffStore.save(handoff);
    // Deterministic data (this method) always succeeds independent of any
    // semantic/AI generation — WakeupGenerator only formats what was saved.
    WakeupGenerator.generate(handoff, this.workspacePath);
    return handoff;
  }

  async getLatestCheckpoint(): Promise<Checkpoint | null> {
    return this.checkpointStore.loadLatest();
  }

  async getLatestHandoff(): Promise<Handoff | null> {
    return this.handoffStore.loadLatest();
  }

  async clearResolvedHandoff(id: string): Promise<void> {
    await this.handoffStore.markResolved(id);
  }

  async evaluateFreshness(handoff: Handoff): Promise<HandoffFreshness> {
    const git = await this.gitProvider.getSnapshot();
    return StaleDetector.evaluate(handoff, git, this.workspacePath);
  }

  /** Returns the resume instruction text (deterministic facts + clearly-labeled untrusted historical context). */
  async buildResumeInstruction(handoff: Handoff): Promise<string> {
    const git = await this.gitProvider.getSnapshot();
    return ResumeReconciler.reconcile(handoff, git, this.workspacePath);
  }
}
