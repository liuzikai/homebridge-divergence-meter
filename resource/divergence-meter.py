import asyncio
from bleak import BleakScanner, BleakClient
import datetime
import cmd

SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb"
CHARACTERISTIC = 4

def SYNC_TIME():
    return "#0" + datetime.datetime.now().strftime('%Y%m%d%H%M%S')

SET_12H = "#400"
SET_24H = "#401"

TIME_MODE = "#430"
RANDOM_MODE = "#4210"
RANDOM_FLASHING = "#4211"
GYRO_MODE = "#422"

def CUSTOMIZED_WORLDLINE(index: int, text: str):
    assert 0 <= index <= 7
    assert len(text) == 8
    return f"#3{index}{text}"

TIME_HHMMSS_DOT_US = "#412"
TIME_ZERO_DOT_HHMMSS = "#411"
TIME_HH_MM_SS = "#410"

def encode_command(string):
    assert len(string) <= 18
    data = (string + '*' * (18 - len(string))).encode("ascii")
    assert len(data) == 18
    return data


class DivergenceMeterShell(cmd.Cmd):
    prompt = '>>> '
    intro = 'Welcome to MyShell! Type ? to list commands.'

async def main():
    client = None

    # print("Looking for BLE device named 'Divergence'...")
    # while client is None:
    #     devices = await BleakScanner.discover(timeout=1)
    #     for d in devices:
    #         if d.name == "Divergence":
    #             client = BleakClient(d.address)

    print("Connecting...")
    client = BleakClient("3ABA705A-08C8-4538-E430-8CF59FA80300")

    await client.connect()
    print(f"Connected to {client.address}")

    services = client.services
    for service in services:
        print('service', service.handle, service.uuid, service.description)
        characteristics = service.characteristics
        for characteristic in characteristics:
            print('Characteristic:', characteristic.handle, characteristic.uuid, characteristic.properties)

    # await client.write_gatt_char(CHARACTERISTIC, encode_command(SYNC_TIME()), response=True)
    # await client.write_gatt_char(CHARACTERISTIC, encode_command(TIME_ZERO_DOT_HHMMSS), response=True)

    await client.write_gatt_char(CHARACTERISTIC, encode_command(CUSTOMIZED_WORLDLINE(3, " " * 8)), response=True)

    await client.disconnect()


asyncio.run(main())
