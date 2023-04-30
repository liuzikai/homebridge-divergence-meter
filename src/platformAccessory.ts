import {Service, PlatformAccessory, CharacteristicValue, Logger, Characteristic, PlatformConfig} from 'homebridge';
import {DivergenceMeterPlatform} from './platform';
import {DivergenceMeter} from './divergenceMeter';
import storage from "node-persist";
import path from "path";

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

  // Display names must not contain special characters like '(' and ')'
  private modes: string[] = [
    'Time Mode 1', 'Time Mode 2', 'Time Mode 3', 'Gyroscope', 'Saved Random',
  ];

  private meter: DivergenceMeter;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private exampleStates = {
    On: 0,
    Brightness: 100,
  };

  constructor(
    private readonly platform: DivergenceMeterPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly config: PlatformConfig,
  ) {

    // Create the BLE backend
    this.meter = new DivergenceMeter(this.log);

    // Set accessory information
    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sadudu')
      .setCharacteristic(this.Characteristic.Model, 'Divergence Meter')
      .setCharacteristic(this.Characteristic.SerialNumber, 'El Psy Congroo');

    // Get the Television service if it exists, otherwise create a new Television service
    this.tv = this.accessory.getService(this.Service.Television) || this.accessory.addService(this.Service.Television);

    this.setupTVService();

    this.setupInputSources();

    // Restore persistent data from persistent storage
    this.setCharacteristicsFromStorage().then();


    /**
     * Creating multiple services of the same type.
     *
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     *
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    // Example: add two "motion sensor" services to the accessory
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //   this.accessory.addService(this.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    /**
     * Updating characteristics values asynchronously.
     *
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     *
     */
    // let motionDetected = false;
    // setInterval(() => {
    //   // EXAMPLE - inverse the trigger
    //   motionDetected = !motionDetected;

    //   // push the new value to HomeKit
    //   motionSensorOneService.updateCharacteristic(this.Characteristic.MotionDetected, motionDetected);
    //   motionSensorTwoService.updateCharacteristic(this.Characteristic.MotionDetected, !motionDetected);

    //   this.log.debug('Triggering motionSensorOneService:', motionDetected);
    //   this.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    // }, 10000);
  }

  setupTVService() {
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
        await storage.setItem('ConfiguredName', value)
      });
  }

  setupInputSources() {
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

  async setCharacteristicsFromStorage() {
    await storage.init({dir: path.join(this.platform.api.user.storagePath(), 'divergence')});
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

  async handleInputSource(mode: number) {
    if (mode in [0, 1, 2]) {  // Time Mode 1-3
      this.meter.timeMode(mode);
    } else if (mode === 3) {  // Gyro Mode
      this.meter.gyroMode();
    } else if (mode === 4) {  // Saved Random
      // Use original worldline 3
      // TODO:
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
  }

  async onSetActiveIdentifier(value) {
    this.log.debug('Set ActiveIdentifier -> ' + value);
    // Apply action
    await this.handleInputSource(value as number);
    // Persist
    await storage.setItem('ActiveIdentifier', value);
  }

  async onSetActive(value: CharacteristicValue) {
    this.log.debug('Set Active ->', value);

    if (value) {
      await this.handleInputSource(this.tv.getCharacteristic(this.Characteristic.ActiveIdentifier).value as number);
    } else {
      this.meter.turnOff();
    }

    // Persist
    await storage.setItem('Active', value);
  }

  async onGetActive(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const isOn = this.tv.getCharacteristic(this.Characteristic.Active).value || false;
    this.log.debug('Get Active, isOn =', isOn);

    if (!this.meter.isConnectedToPeripheral()) {
      // show the device as "Not Responding" in the Home app
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return isOn;
  }

}
