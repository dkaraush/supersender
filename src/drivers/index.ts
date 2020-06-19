type DriverRun = (args: any) => Promise<string | Buffer | void>;
export default interface Driver {
    name : string;
    run: DriverRun;
}

import ServerLog from './server-log';
const driversRaw : Driver[] = [
    ServerLog
];

export const drivers : Map<string, Driver> = new Map<string, Driver>(
    driversRaw.map(driver => [driver.name, driver])
);