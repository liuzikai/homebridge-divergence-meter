import noble, {Peripheral, Characteristic} from '@abandonware/noble';
import {Logger} from 'homebridge';

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const PERIPHERAL_NAME = 'Divergence';

export class DivergenceMeter {
  private characteristic: Characteristic | null = null;
  private peripheral: Peripheral | null = null;
  private hasStartedScanning = false;
  private isConnected = false;

  constructor(
    public readonly log: Logger,
    private scanningRestartDelay: number,
  ) {
    noble.on('stateChange', this.onNobleStateChange.bind(this));
    noble.on('discover', this.onDiscoverPeripheral.bind(this));
    noble.on('scanStart', this.onNobleScanStart.bind(this));
    noble.on('scanStop', this.onNobelScanStop.bind(this));
    noble.on('warning', this.onNobelWarning.bind(this));
  }

  onNobleStateChange(state: string) {
    if (state === 'poweredOn') {
      this.startScanning();
    } else {
      this.log.info(`Noble state changed to ${state}`);
      this.hasStartedScanning = false;
      noble.stopScanning();
    }
  }

  onNobelWarning(message) {
    this.log.info('Noble warning: ', message);
  }

  onNobelScanStop() {
    this.log.debug('On scanStop (this app or another app)');
    if (this.hasStartedScanning && !this.peripheral) {
      setTimeout(() => {
        this.log.info('Restart scanning');
        this.startScanning();
      }, this.scanningRestartDelay);
    }
  }

  onNobleScanStart() {
    this.log.debug('On scanStart (this app or another app)');
  }

  startScanning() {
    this.log.info(`Start scanning for ${PERIPHERAL_NAME}...`);
    this.hasStartedScanning = true;
    noble.startScanning([SERVICE_UUID], false);
  }

  onDiscoverPeripheral(peripheral: Peripheral) {
    this.log.debug(`Discovered ${peripheral.advertisement.localName}`);
    if (peripheral.advertisement.localName !== PERIPHERAL_NAME) {
      return;
    }
    this.log.info(`Found ${PERIPHERAL_NAME}!`);

    // At this stage, we have the PERIPHERAL_NAME and the SERVICE_UUID matched.
    // We assume we can find the characteristic in the peripheral. Just allow stopScanning.
    // If not, this.characteristic won't be set, and write function below will handle this.
    if (this.peripheral) {
      peripheral.once('disconnect', () => null);  // clear the disconnect handler
    }
    this.peripheral = peripheral;
    noble.stopScanning();

    peripheral.connect(error => {
      if (error) {
        this.log.error(`Failed to connect: ${error}`);
        this.isConnected = false;
        // this.peripheral should not have disconnect yet
        this.peripheral = null;
        this.startScanning();
      } else {
        this.log.info(`Connected to ${PERIPHERAL_NAME}`);
        peripheral.discoverSomeServicesAndCharacteristics(
          [SERVICE_UUID],
          [CHARACTERISTIC_UUID],
          (error, services, characteristics) => {
            if (error) {
              this.log.error(`Failed to discover characteristics: ${error}`);
              this.isConnected = false;
              // this.peripheral should not have disconnect yet
              this.peripheral = null;
              this.startScanning();
            } else {
              this.characteristic = characteristics[0];
              peripheral.once('disconnect', this.onPeripheralDisconnect.bind(this));
              this.isConnected = true;
            }
          },
        );
      }
    });
  }

  onPeripheralDisconnect() {
    this.log.info(`Disconnected from ${PERIPHERAL_NAME} peripheral. Restart scanning...`);
    this.isConnected = false;
    this.startScanning();
  }

  public isConnectedToPeripheral(): boolean {
    return this.isConnected;
  }

  public write(data: Buffer) {
    if (!this.isConnected) {
      this.log.warn(`Cannot write to ${PERIPHERAL_NAME}: not connected`);
      return;
    }
    if (!this.characteristic) {
      this.log.warn(`Cannot write to ${PERIPHERAL_NAME}: no characteristic found`);
      this.isConnected = false;
      this.startScanning();
      return;
    }

    // No callback, or one new callback is registered every time
    this.characteristic.write(data, false)
  }

  public sendCommand(command: string) {
    if (command.length > 18) {
      this.log.error(`Command too long: ${command}`);
    } else {
      const buffer = Buffer.from(command.padEnd(18, '*'));
      this.write(buffer);
    }
  }

  public turnOff() {
    this.sendCommand('#33        ');  // customized worldline 4
  }

  public worldlineMode(index: number, text: string) {
    if (!Number.isInteger(index) || index < 0 || index > 7) {
      this.log.error('Index must be an integer in the range of 0 to 7');
      return;
    }
    if (text.length !== 8) {
      this.log.error('Text must have length 8');
      return;
    }
    this.sendCommand('#3' + index.toString() + text);
  }

  public timeMode(mode: number) {
    if (mode === 0) {
      this.sendCommand('#410'); // HH MM SS
    } else if (mode === 1) {
      this.sendCommand('#411'); // 0.HHMMSS
    } else if (mode === 2) {
      this.sendCommand('#412'); // HHMMSS.uS
    }
    this.sendCommand('#430');
  }

  public gyroMode() {
    this.sendCommand('#422');
  }

  public randomMode(flashing: boolean) {
    if (flashing) {
      this.sendCommand('#4211');
    } else {
      this.sendCommand('#4210');
    }
  }

  public set12Or24H(use24H: boolean) {
    if (use24H) {
      this.sendCommand('#400');
    } else {
      this.sendCommand('#401');
    }
  }

  getFormattedTime(): string {
    const now = new Date();
    return now.toISOString().replace(/[-:.T]/g, "").substr(0, 14);
  }

  public syncTime() {
    this.sendCommand('#0' + this.getFormattedTime());
  }
}
