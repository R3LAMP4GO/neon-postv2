import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock grammy's InlineKeyboard
const mockKeyboardInstance = {
  text: vi.fn().mockReturnThis(),
  row: vi.fn().mockReturnThis(),
};
vi.mock('grammy', () => {
  // Must use a real function constructor (not arrow fn) so `new` works
  function InlineKeyboard(this: any) {
    Object.assign(this, mockKeyboardInstance);
    return this;
  }
  return {
    InlineKeyboard,
    Bot: vi.fn(),
    Api: vi.fn(),
  };
});

import { InlineKeyboardBuilder } from '../../src/channels/telegram/keyboards/inline';

describe('InlineKeyboardBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeyboardInstance.text.mockReturnThis();
    mockKeyboardInstance.row.mockReturnThis();
  });

  describe('addButton', () => {
    it('should add a single button as its own row', () => {
      const builder = new InlineKeyboardBuilder();

      const result = builder.addButton('Click me', 'action_click');

      // Should return this for chaining
      expect(result).toBe(builder);
      expect(builder.isEmpty()).toBe(false);
    });

    it('should support chaining multiple buttons', () => {
      const builder = new InlineKeyboardBuilder();

      builder.addButton('Btn 1', 'action_1').addButton('Btn 2', 'action_2');

      expect(builder.isEmpty()).toBe(false);
    });
  });

  describe('addRow', () => {
    it('should add a row of buttons', () => {
      const builder = new InlineKeyboardBuilder();

      const result = builder.addRow([
        { text: 'A', callbackData: 'a' },
        { text: 'B', callbackData: 'b' },
      ]);

      expect(result).toBe(builder);
      expect(builder.isEmpty()).toBe(false);
    });

    it('should add multiple rows', () => {
      const builder = new InlineKeyboardBuilder();

      builder
        .addRow([{ text: 'Row 1 A', callbackData: 'r1a' }])
        .addRow([{ text: 'Row 2 A', callbackData: 'r2a' }, { text: 'Row 2 B', callbackData: 'r2b' }]);

      expect(builder.isEmpty()).toBe(false);
    });
  });

  describe('build', () => {
    it('should create an InlineKeyboard from grammy', () => {
      const builder = new InlineKeyboardBuilder();
      builder.addButton('Test', 'test_action');

      const keyboard = builder.build();

      // InlineKeyboard constructor should have been called
      expect(keyboard).toBeDefined();
    });

    it('should call text() for each button and row() for each row', () => {
      const builder = new InlineKeyboardBuilder();
      builder.addRow([
        { text: 'A', callbackData: 'a' },
        { text: 'B', callbackData: 'b' },
      ]);
      builder.addButton('C', 'c');

      builder.build();

      // Row 1: text('A', 'a'), text('B', 'b'), row()
      // Row 2 (from addButton): text('C', 'c'), row()
      expect(mockKeyboardInstance.text).toHaveBeenCalledWith('A', 'a');
      expect(mockKeyboardInstance.text).toHaveBeenCalledWith('B', 'b');
      expect(mockKeyboardInstance.text).toHaveBeenCalledWith('C', 'c');
      expect(mockKeyboardInstance.row).toHaveBeenCalledTimes(2);
    });

    it('should build empty keyboard when no buttons added', () => {
      const builder = new InlineKeyboardBuilder();

      const keyboard = builder.build();

      expect(keyboard).toBeDefined();
      expect(mockKeyboardInstance.text).not.toHaveBeenCalled();
      expect(mockKeyboardInstance.row).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should remove all buttons', () => {
      const builder = new InlineKeyboardBuilder();
      builder.addButton('Test', 'action');
      expect(builder.isEmpty()).toBe(false);

      const result = builder.clear();

      expect(builder.isEmpty()).toBe(true);
      expect(result).toBe(builder); // chaining
    });
  });

  describe('isEmpty', () => {
    it('should return true for new builder', () => {
      const builder = new InlineKeyboardBuilder();

      expect(builder.isEmpty()).toBe(true);
    });

    it('should return false after adding buttons', () => {
      const builder = new InlineKeyboardBuilder();
      builder.addButton('Test', 'action');

      expect(builder.isEmpty()).toBe(false);
    });

    it('should return true after clearing', () => {
      const builder = new InlineKeyboardBuilder();
      builder.addButton('Test', 'action');
      builder.clear();

      expect(builder.isEmpty()).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should build a multi-row keyboard with mixed button types', () => {
      const builder = new InlineKeyboardBuilder();

      builder
        .addRow([
          { text: 'Option 1', callbackData: 'opt_1' },
          { text: 'Option 2', callbackData: 'opt_2' },
        ])
        .addRow([
          { text: 'Option 3', callbackData: 'opt_3' },
        ])
        .addButton('Cancel', 'cancel');

      builder.build();

      expect(mockKeyboardInstance.text).toHaveBeenCalledTimes(4);
      expect(mockKeyboardInstance.row).toHaveBeenCalledTimes(3);
    });

    it('should support clear and rebuild', () => {
      const builder = new InlineKeyboardBuilder();
      builder.addButton('Old', 'old');
      builder.clear();
      builder.addButton('New', 'new');

      builder.build();

      expect(mockKeyboardInstance.text).toHaveBeenCalledWith('New', 'new');
      expect(mockKeyboardInstance.text).toHaveBeenCalledTimes(1);
    });
  });
});
