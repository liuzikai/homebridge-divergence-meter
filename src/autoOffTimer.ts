export class AutoOffTimer {
  private remainingTime: number;
  private countdownInterval: NodeJS.Timeout | null = null;

  /**
   * Create an AutoOffTimer
   * @param totalTime
   * @param onEndCallback  Returns 0 on success, or a positive integer as the number of seconds to retry after.
   */
  constructor(
    private totalTime: number,
    private onEndCallback: () => number,
  ) {
    this.remainingTime = totalTime;
  }

  /**
   * Start the timer, or reset the time if already started.
   */
  public start() {
    this.remainingTime = this.totalTime;
    if (!this.countdownInterval) {
      this.countdownInterval = setInterval(() => {
        this.tick();
      }, 1000);
    }
  }

  private tick() {
    if (this.remainingTime <= 0) {
      this.stop();
      const res = this.onEndCallback();
      if (res > 0) {
        this.remainingTime = res;  // retry after this time
      }
    }
    this.remainingTime--;
  }

  public stop() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}
