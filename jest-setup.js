// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
  measureText: (text) => ({ width: text.length * 8 }),
}));
