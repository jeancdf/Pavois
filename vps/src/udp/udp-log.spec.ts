import { isUdpVerbose, udpDebug } from './udp-log';

describe('udp verbose logging', () => {
  const previous = process.env.UDP_VERBOSE;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.UDP_VERBOSE;
    } else {
      process.env.UDP_VERBOSE = previous;
    }
  });

  it('is off by default', () => {
    delete process.env.UDP_VERBOSE;
    expect(isUdpVerbose()).toBe(false);
  });

  it('accepts true and 1', () => {
    process.env.UDP_VERBOSE = 'true';
    expect(isUdpVerbose()).toBe(true);
    process.env.UDP_VERBOSE = '1';
    expect(isUdpVerbose()).toBe(true);
  });

  it('stays silent when verbose is off', () => {
    delete process.env.UDP_VERBOSE;
    const spy = jest.spyOn(console, 'log').mockImplementation();
    udpDebug('should not print');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('prints when verbose is on', () => {
    process.env.UDP_VERBOSE = 'true';
    const spy = jest.spyOn(console, 'log').mockImplementation();
    udpDebug('[UDP] packet', { n: 1 });
    expect(spy).toHaveBeenCalledWith('[UDP] packet', { n: 1 });
    spy.mockRestore();
  });
});
