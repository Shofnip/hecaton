/** Dispatches one global start concurrently and ignores another until it completes. */
export class StartAll {
  private active = false

  get running(): boolean {
    return this.active
  }

  async run(
    ids: readonly number[],
    start: (id: number) => Promise<unknown>,
    onError: (error: unknown) => void,
  ): Promise<boolean> {
    if (this.active) return false
    this.active = true
    try {
      await Promise.all(
        ids.map(async (id) => {
          try {
            await start(id)
          } catch (error) {
            onError(error)
          }
        }),
      )
      return true
    } finally {
      this.active = false
    }
  }
}
