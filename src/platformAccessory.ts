import {Service, PlatformAccessory, CharacteristicValue, Logger, Characteristic} from 'homebridge';
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

    // Set the service name, this is what is displayed as the default name on the Home app
    // Use the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.tv.setCharacteristic(this.Characteristic.Name, accessory.context.displayName);

    // https://developers.homebridge.io/#/service/Television

    this.tv.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Restore persistent data from persistent storage
    this.setCharacteristicsFromStorage().then();

    // Register handlers for the Active Characteristic
    this.tv.getCharacteristic(this.Characteristic.Active)
      .onSet(this.setActive.bind(this))                // SET - bind to the `setActive` method below
      .onGet(this.getActive.bind(this));               // GET - bind to the `getActive` method below

    // Handle input source changes
    this.tv.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(this.onSetActiveIdentifier.bind(this));

    // Handle ConfiguredName changes
    this.tv.getCharacteristic(this.Characteristic.ConfiguredName)
      .onSet(async (value) => {
        // Persist
        await storage.setItem('ConfiguredName', value)
      });

    // Display modes
    // Display name must not contain special characters like '(' and ')'
    const modes = [
      'Time Mode 1', 'Time Mode 2', 'Time Mode 3', 'Gyroscope', 'Saved Random',
    ];
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];

      // Need to loop up the service by name due to the same type
      const inputService = this.accessory.getService(mode) ||
        // Here the mode.displayName is the default name of the input source
        this.accessory.addService(this.Service.InputSource, mode, mode.replace(/ /g, '_'));

      inputService
        .setCharacteristic(this.Characteristic.Identifier, i)

        // Not sure what this is
        .setCharacteristic(this.Characteristic.Name, mode)

        // ConfiguredName is read during setup and written when user set it
        // Changing this value from here is not reliable. Experiment shows that it's not pulled by iOS when the
        // TV is off. It's pulled at a very low frequency if the TV is on.
        .setCharacteristic(this.Characteristic.ConfiguredName, mode)

        // NOT_CONFIGURED makes the input source invisible
        // It seems that IsConfigured is never set
        .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)

        .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.HDMI)
        .setCharacteristic(this.Characteristic.CurrentVisibilityState, this.Characteristic.CurrentVisibilityState.SHOWN);

      // Link to the tv service
      this.tv.addLinkedService(inputService);
    }


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

  async onSetActiveIdentifier(value) {
    this.log.debug('Set ActiveIdentifier -> ' + value);
    // Apply action
    await this.handleInputSource(value as number);
    // Persist
    await storage.setItem('ActiveIdentifier', value);
  }

  async setCharacteristicsFromStorage() {
    await storage.init({dir: path.join(this.platform.api.user.storagePath(), 'divergence')});
    this.tv.updateCharacteristic(this.Characteristic.ConfiguredName, await storage.getItem('ConfiguredName') || 'Divergence Meter');
    this.tv.updateCharacteristic(this.Characteristic.Active, await storage.getItem('Active') || this.Characteristic.Active.INACTIVE);
    this.tv.updateCharacteristic(this.Characteristic.ActiveIdentifier, await storage.getItem('ActiveIdentifier') || 0);
  }

  async handleInputSource(mode: number) {
    if (mode in [0, 1, 2]) {
      this.meter.timeMode(mode);
    } else if (mode === 3) {
      this.meter.gyroMode();
    } else if (mode === 4) {
      // TODO:
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setActive(value: CharacteristicValue) {
    this.log.debug('Set Active ->', value);

    if (value) {
      await this.handleInputSource(this.tv.getCharacteristic(this.Characteristic.ActiveIdentifier).value as number);
    } else {
      this.meter.turnOff();
    }

    // Persist
    await storage.setItem('Active', value);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.Characteristic.On, true)
   */
  async getActive(): Promise<CharacteristicValue> {
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
