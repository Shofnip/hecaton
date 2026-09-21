/** Runs timer work one at a time and makes teardown wait for the active tick. */
export class SingleFlightTask {
  private active: Promise<void> | undefined
  private stopped = false

  constructor(
    private readonly work: () => Promise<void>,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  run(): void {
    if (this.stopped || this.active !== undefined) return
    let work: Promise<void>
    try {
      work = this.work()
    } catch (error) {
      this.onError(error)
      return
    }
    const active = work.catch((error: unknown) => this.onError(error))
    this.active = active
    void active.finally(() => {
      if (this.active === active) this.active = undefined
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.active
  }
}
