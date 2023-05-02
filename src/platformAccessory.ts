import {Service, PlatformAccessory, CharacteristicValue, Logger, Characteristic, PlatformConfig} from 'homebridge';
import {DivergenceMeterPlatform} from './platform';
import {DivergenceMeter} from './divergenceMeter';
import {AutoOffTimer} from './autoOffTimer';
import storage from 'node-persist';
import path from 'path';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DivergenceMeterAccessory {
  public readonly log: Logger = this.platform.log;
  public readonly Service: typeof Service = this.platform.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.platform.api.hap.Characteristic;

  private tv: Service;
  private rand: Service;

  // Display names must not contain special characters like '(' and ')'
  private modes: string[] = [
    'Time Mode 1', 'Time Mode 2', 'Time Mode 3', 'Gyroscope', 'Saved Random',
  ];

  private meter: DivergenceMeter;
  private timer: AutoOffTimer | null;

  private savedRandom: string;

  constructor(
    private readonly platform: DivergenceMeterPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly config: PlatformConfig,
  ) {

    this.savedRandom = '0.000000';  // may be overwritten by loadPersistentStorage()

    // Create the BLE backend
    this.meter = new DivergenceMeter(this.log, this.platform.api, this.config.scanningRestartDelay || 2000);

    // Create the auto-off timer
    const {
      autoOff = false,
      autoOffTime = 300,
    } = this.config;
    if (autoOff) {
      this.log.debug(`Enable auto-off of ${autoOffTime} seconds`);
      this.timer = new AutoOffTimer(autoOffTime, this.onAutoOffTimeout.bind(this));
    } else {
      this.timer = null;
    }

    // Set accessory information
    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sadudu')
      .setCharacteristic(this.Characteristic.Model, 'Divergence Meter')
      .setCharacteristic(this.Characteristic.SerialNumber, 'El Psy Congroo');

    // Get the Television service if it exists, otherwise create a new Television service
    this.tv = this.accessory.getService(this.Service.Television) || this.accessory.addService(this.Service.Television);
    this.setupTVService();
    this.setupInputSources();

    // Random button
    this.rand = this.accessory.getService(this.Service.Switch) || this.accessory.addService(this.Service.Switch);
    this.rand.setCharacteristic(this.Characteristic.Name, this.config.randomSwitchName || 'Random Worldline');
    this.rand.setCharacteristic(this.Characteristic.On, false);
    this.rand.getCharacteristic(this.Characteristic.On)
      .onSet(this.onRandSetOn.bind(this));

    // Restore persistent data from persistent storage
    this.loadPersistentStorage().then();
  }

  private setupTVService() {
    // Set the service name, this is what is displayed as the default name on the Home app
    this.tv.setCharacteristic(this.Characteristic.Name, this.config.name || 'Divergence Meter');

    // https://developers.homebridge.io/#/service/Television

    this.tv.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Register handlers for the Active Characteristic
    this.tv.getCharacteristic(this.Characteristic.Active)
      .onSet(this.onSetActive.bind(this))
      .onGet(this.onGetActive.bind(this));

    // Handle input source changes
    this.tv.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(this.onSetActiveIdentifier.bind(this));

    // Handle ConfiguredName changes
    this.tv.getCharacteristic(this.Characteristic.ConfiguredName)
      .onSet(async (value) => {
        // Persist
        await storage.setItem('ConfiguredName', value);
      });
  }

  private setupInputSources() {
    // Add customized worldlines
    if (this.config.worldlines) {
      for (let i = 0; i < this.config.worldlines.length; i++) {
        this.modes.push('Worldline ' + (i + 1));
      }
    }
    this.log.debug('Modes:', this.modes);

    // Clean up deleted input sources
    const servicesToDelete: Service[] = [];
    for (const service of this.accessory.services) {
      if (service instanceof this.Service.InputSource && this.modes.indexOf(service.displayName) === -1) {
        servicesToDelete.push(service);
      }
    }
    for (const service of servicesToDelete) {
      this.accessory.removeService(service);
    }
    this.log.debug('servicesToDelete:', servicesToDelete);

    // Add input sources
    for (let i = 0; i < this.modes.length; i++) {
      const mode = this.modes[i];

      // Need to loop up the service by name due to the same type
      const inputService = this.accessory.getService(mode) ||
        // Here the mode.displayName is the default name of the input source
        this.accessory.addService(this.Service.InputSource, mode, mode.replace(/ /g, '_'));

      inputService
        .setCharacteristic(this.Characteristic.Identifier, i)
        .setCharacteristic(this.Characteristic.Name, mode)

        // NOT_CONFIGURED makes the input source invisible
        // It seems that IsConfigured is never set
        .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)

        .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.HDMI)
        .setCharacteristic(this.Characteristic.CurrentVisibilityState, this.Characteristic.CurrentVisibilityState.SHOWN);

      // ConfiguredName is set async in setCharacteristicsFromStorage below

      // Link to the tv service
      this.tv.addLinkedService(inputService);
    }
  }

  private async loadPersistentStorage() {
    await storage.init({dir: path.join(this.platform.api.user.storagePath(), 'divergence')});
    this.savedRandom = await storage.getItem('savedRandom') || '0.000000';
    this.tv.updateCharacteristic(this.Characteristic.ConfiguredName, await storage.getItem('ConfiguredName') || 'Divergence Meter');
    this.tv.updateCharacteristic(this.Characteristic.Active, await storage.getItem('Active') || this.Characteristic.Active.INACTIVE);
    this.tv.updateCharacteristic(this.Characteristic.ActiveIdentifier, await storage.getItem('ActiveIdentifier') || 0);
    for (let i = 0; i < this.modes.length; i++) {
      const mode = this.modes[i];
      const inputService = this.accessory.getService(mode)!;
      const persistKey = mode + ' ConfiguredName';
      inputService.setCharacteristic(this.Characteristic.ConfiguredName, await storage.getItem(persistKey) || mode);
      inputService.getCharacteristic(this.Characteristic.ConfiguredName)
        .onSet(async (value) => {
          // Persist
          await storage.setItem(persistKey, value);
        });
    }
  }

  private async handleInputSource(mode: number) {
    if (mode in [0, 1, 2]) {  // Time Mode 1-3
      this.meter.timeMode(mode);
    } else if (mode === 3) {  // Gyro Mode
      this.meter.gyroMode();
    } else if (mode === 4) {  // Saved Random
      // Use original worldline 3
      this.meter.worldlineMode(2, this.savedRandom);
    } else if (mode <= 6) {  // Worldline 1 & 2
      // Use original worldline 1 & 2
      this.meter.worldlineMode(mode - 5, this.config.worldlines[mode - 5]);
    } else if (mode <= 9) {  // Worldline 3-5
      // Use original worldline 5 - 7
      this.meter.worldlineMode(mode - 3, this.config.worldlines[mode - 5]);
    } else {  // Worldline 6+
      // Use original worldline 8
      this.meter.worldlineMode(7, this.config.worldlines[mode - 5]);
    }
    if (this.timer) {
      this.timer.start();
    }
  }

  private controlledRandomFloat(): number {
    const {randomMin, randomMax} = this.config;
    return Math.random() * (randomMax - randomMin) + randomMin;
  }

  private convertFloatToWorldline(x: number): string {
    const y = x >= 0 ? x : -x;  // abs
    let s = y.toFixed(8);  // extend as much as possible
    s = s.slice(0, 8);

    // Handle negative float
    if (x < 0 && s.indexOf('.') !== -1) {
      // Replace the part before '.' to spaces
      s = s.replace(/^.*?\./, ' '.repeat(s.indexOf('.')) + '.');
    }

    // Users can do all kinds of wired things, such as extremely large numbers
    // Just handling the typical floating point cases and what ever
    if (s.length === 8) {
      return s;
    } else if (s.length > 8) {
      this.log.warn('Bad worldline to display:', s);
      return s.slice(0, 8);
    } else {
      this.log.warn('Bad worldline to display:', s);
      return s.padEnd(8, ' ');
    }
  }

  private async onSetActiveIdentifier(value) {
    this.log.debug('Set ActiveIdentifier -> ' + value);
    // Apply action
    await this.handleInputSource(value as number);
    // Persist
    await storage.setItem('ActiveIdentifier', value);
  }

  private async onSetActive(value: CharacteristicValue) {
    this.log.debug('Set Active ->', value);

    if (value) {
      await this.handleInputSource(this.tv.getCharacteristic(this.Characteristic.ActiveIdentifier).value as number);
    } else {
      this.meter.turnOff();
      // If throw an error, return, timer will not stop, as expected (will retry later)
      if (this.timer) {
        this.timer.stop();
      }
    }

    // Persist
    await storage.setItem('Active', value);
  }

  private async onGetActive(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const isOn = this.tv.getCharacteristic(this.Characteristic.Active).value || false;
    this.log.debug('Get Active, isOn =', isOn);

    if (!this.meter.isConnectedToPeripheral()) {
      this.log.debug('Get Active, no response');
      // show the device as "Not Responding" in the Home app
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return isOn;
  }

  private async onRandSetOn(value: CharacteristicValue) {
    const isOn = value as boolean;
    this.log.debug('Rand set On ->', isOn);
    if (isOn) {
      this.meter.randomMode(true);
      if (this.timer) {
        this.timer.start();
      }

      // Turn on if not
      this.tv.updateCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE);
    } else {
      if (this.tv.getCharacteristic(this.Characteristic.ActiveIdentifier).value === 4) {
        // Saved Random
        this.savedRandom = this.convertFloatToWorldline(this.controlledRandomFloat());
        this.log.debug('this.savedRandom =', this.savedRandom);
        await this.handleInputSource(4);
        await storage.setItem('savedRandom', this.savedRandom);
      } else {
        // Random random
        this.meter.randomMode(false);
        if (this.timer) {
          this.timer.start();
        }
      }
    }
  }

  private onAutoOffTimeout(): number {
    try {
      this.log.debug('Time up! Turn off');
      this.meter.turnOff();
      return 0;
    } catch (e) {
      this.log.warn(`Failed to turn off: ${e}, retry after 10s`);
      return 10;
    }
  }

}
