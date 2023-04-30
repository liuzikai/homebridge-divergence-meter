import noble, { Peripheral, Characteristic } from '@abandonware/noble';
import { Logger } from 'homebridge';

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const PERIPHERAL_NAME = 'Divergence';

export class DivergenceMeter {
  private characteristic: Characteristic | null = null;
  private isConnected = false;

  constructor(public readonly log: Logger) {
    noble.on('stateChange', state => {
      if (state === 'poweredOn') {
        this.log.info(`Scanning for ${PERIPHERAL_NAME}...`);
        noble.startScanning([SERVICE_UUID], false);
      } else {
        this.log.warn(`Noble state changed to ${state}`);
        noble.stopScanning();
      }
    });

    noble.on('discover', peripheral => {
      if (peripheral.advertisement.localName === PERIPHERAL_NAME) {
        this.log.info(`Found ${PERIPHERAL_NAME}!`);
        noble.stopScanning();

        peripheral.connect(error => {
          if (error) {
            this.log.error(`Failed to connect: ${error}`);
            this.isConnected = false;
            noble.startScanning([SERVICE_UUID], false);
          } else {
            this.log.info(`Connected to ${PERIPHERAL_NAME}!`);
            this.isConnected = true;
            peripheral.discoverSomeServicesAndCharacteristics(
              [SERVICE_UUID],
              [CHARACTERISTIC_UUID],
              (error, services, characteristics) => {
                if (error) {
                  this.log.error(`Failed to discover characteristics: ${error}`);
                } else {
                  this.characteristic = characteristics[0];
                }
              }
            );
          }
        });

        peripheral.once('disconnect', () => {
          this.log.warn(`Disconnected from ${PERIPHERAL_NAME} peripheral!`);
          this.isConnected = false;
          noble.startScanning([SERVICE_UUID], false);
        });
      }
    });
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
      return;
    }
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
}
