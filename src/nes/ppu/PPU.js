import { WithContext } from "../helpers";
import { MemoryChunk } from "../memory";
import {
	PPUCtrl,
	PPUMask,
	PPUStatus,
	OAMAddr,
	OAMData,
	PPUScroll,
	PPUAddr,
	PPUData,
	OAMDMA
} from "./registers";
import { cycleType, scanlineType } from "./constants";
import PPUMemoryMap from "./PPUMemoryMap";
import PatternTable from "./PatternTable";
import _ from "lodash";

const INITIAL_PPUSTATUS = 0b10000000;
const PRIMARY_OAM_SIZE = 256;
const SECONDARY_OAM_SIZE = 32;
const LAST_CYCLE = 340;
const LAST_SCANLINE = 261;
const SPRITES_PER_SCANLINE = 8;

/** The Picture Processing Unit. It generates a video signal of 256x240 pixels. */
export default class PPU {
	constructor() {
		WithContext.apply(this);

		this.frame = 0;
		this.scanline = 0;
		this.cycle = 0;

		this.memory = new PPUMemoryMap();
		this.patternTable = new PatternTable();
		this.oamRam = null; // OAM = Object Attribute Memory (contains sprite data)
		this.oamRam2 = null;

		this.registers = {
			ppuCtrl: new PPUCtrl(),
			ppuMask: new PPUMask(),
			ppuStatus: new PPUStatus(),
			oamAddr: new OAMAddr(),
			oamData: new OAMData(),
			ppuScroll: new PPUScroll(),
			ppuAddr: new PPUAddr(),
			ppuData: new PPUData(),
			oamDma: new OAMDMA()
		};

		this.internal = {
			v: 0, // current vram address (15 bit)
			t: 0, // temporary vram address (15 bit)
			y: 0, // y, used to help compute vram address
			x: 0, // fine x scroll (3 bit)
			w: 0, // write toggle (1 bit)
			register: 0,
			registerRead: 0,
			registerBuffer: 0,
			render: {
				backgroundTileBuffer: null,
				lowTileByte: 0,
				highTileByte: 0,
				attributeTableByte: 0,
				spriteCount: 0,
				sprites: null
			}
		};

		this.flags = {
			isFrameReady: false,
			nmiOccurred: false
		};

		this._cycleType = null;
		this._scanlineType = null;
	}

	/** When a context is loaded. */
	onLoad(context) {
		this.memory.loadContext(context);
		this.patternTable.loadContext(context);
		this.oamRam = new MemoryChunk(PRIMARY_OAM_SIZE);
		this.oamRam2 = new MemoryChunk(SECONDARY_OAM_SIZE);
		_.each(this.registers, (register) => register.loadContext(context.memory));
		this._reset();
	}

	/** Executes cycles until reaching `masterCycle`. */
	stepTo(masterCycle) {
		while (this.cycle < masterCycle) this.step();
	}

	/** Executes the next cycle. */
	step() {
		this._cycleType = cycleType(this.cycle);
		this._scanlineType = scanlineType(this.scanline);

		let interrupt = null;
		if (this.scanlineType === "VBLANK_START") {
			interrupt = this._doVBlankLine();
		} else if (this._isRenderingEnabled) {
			if (this.scanlineType === "PRELINE") {
				interrupt = this._doPreline();
			} else if (this.scanlineType === "VISIBLE") {
				interrupt = this._doVisibleLine();
			}
		}

		this._incrementCounters();

		return interrupt;
	}

	/** When the current context is unloaded. */
	onUnload() {
		this._reset();
		this.patternTable.unloadContext();
		this.memory.unloadContext();
		this.oamRam = null;
		this.oamRam2 = null;
		_.each(this.registers, (register) => register.unloadContext());
	}

	_renderPixel() {
		// const x = this.cycle - 1;
		// const y = this.scanline;
		// const backgroundVisible = !!this.registers.ppuMask.showBackground;
		// const spritesVisible = !!this.registers.ppuMask.showSprites;
	}

	_doPreline() {
		if (
			this._cycleType === "ONE" ||
			this._cycleType === "VISIBLE" ||
			this._cycleType === "PREFETCH"
		) {
			this.internal.render.backgroundTileBuffer.shift();

			if (this.cycle % 8 === 0) {
				if (this.cycle < 256) {
					this._fetchAndStoreBackgroundRow();
				}
				this._updateScrollingX();
			}
		}

		if (this._cycleType === "SPRITES") {
			this.internal.render.spriteCount = 0;
		}

		if (this._cycleType === "COPY_Y") {
			// https://wiki.nesdev.com/w/index.php/PPU_scrolling#During_dots_280_to_304_of_the_pre-render_scanline_.28end_of_vblank.29
			this.internal.v = (this.internal.v & 0x841f) | (this.internal.t & 0x7be0);
		}

		this._updateScrollingY();

		if (this._cycleType === "ONE") {
			this._clearVerticalBlank();
		}

		if (this._cycleType === "MAPPER_TICK") {
			// if (this.memory.mapper.tick()) { // TODO: Add Mapper::tick()
			// 	// (only used for a few mappers)
			// 	return "IRQ";
			// }
		}
	}

	_doVisibleLine() {
		if (this._cycleType === "ONE" || this._cycleType === "VISIBLE") {
			// this.renderPixel(); // TODO: Implement
		}

		if (this._cycleType === "VISIBLE") {
			this.internal.render.backgroundTileBuffer.shift();

			if (this.cycle % 8 === 0) {
				if (this.cycle < 256) {
					this._fetchAndStoreBackgroundRow();
				}
				this._updateScrollingX();
			}
		} else if (this._cycleType === "FLUSH_TILEDATA") {
			this.internal.render.backgroundTileBuffer.length = 0;
		} else if (this._cycleType === "PREFETCH") {
			if (this.cycle % 8 === 0) {
				this._fetchAndStoreBackgroundRow(); // TODO: Implement
				this._updateScrollingX(); // TODO: Implement
			}
		}

		this._updateScrollingY();

		if (this._cycleType === "SPRITES") {
			this._fetchAndStoreSpriteRows(); // TODO: Implement
		}

		if (this._cycleType === "MAPPER_TICK") {
			// if (this.memory.mapper.tick()) { // TODO: Add Mapper::tick()
			// 	return "IRQ";
			// }
		}

		return null;
	}

	_doVBlankLine() {
		if (this._cycleType === "SPRITES") {
			this.internal.render.spriteCount = 0;
		}

		// Vertical Blank is set at second tick of scanline 241
		if (this._cycleType === "ONE") {
			this._setVerticalBlank();
			if (this.registers.ppuCtrl.generateNmiAtStartOfVBlank) {
				return "NMI";
			}
		}

		return null;
	}

	_updateScrollingY() {
		// This one is a mess
		// Values are coming from nesdev, don't touch, don't break

		if (this.cycleType === "INCREMENT_Y") {
			// https://wiki.nesdev.com/w/index.php/PPU_scrolling#Y_increment

			// increment vert(v)
			// if fine Y < 7
			if ((this.internal.v & 0x7000) !== 0x7000) {
				// increment fine Y
				this.internal.v += 0x1000;
			} else {
				// fine Y = 0
				this.internal.v = this.internal.v & 0x8fff;
				// let y = coarse Y
				this.internal.y = (this.internal.v & 0x03e0) >> 5;
				if (this.internal.y === 29) {
					// coarse Y = 0
					this.internal.y = 0;
					// switch vertical nametable
					this.internal.v = this.internal.v ^ 0x0800;
				} else if (this.internal.y === 31) {
					// coarse Y = 0, nametable not switched
					this.internal.y = 0;
				} else {
					// increment coarse Y
					this.internal.y++;
				}
				// put coarse Y back into v
				this.internal.v = (this.internal.v & 0xfc1f) | (this.internal.y << 5);
			}
		}

		if (this.cycleType === "COPY_X") {
			// https://wiki.nesdev.com/w/index.php/PPU_scrolling#At_dot_257_of_each_scanline

			this.internal.v = (this.internal.v & 0xfbe0) | (this.internal.t & 0x041f);
		}
	}

	_setVerticalBlank() {
		this.flags.nmiOccurred = true;
	}

	_clearVerticalBlank() {
		this.flags.nmiOccurred = false;
		this.flags.isFrameReady = true;
	}

	_incrementCounters() {
		// cycle:      [0 ... LAST_CYCLE]
		// scanline:   [0 ... LAST_SCANLINE]

		this.cycle++;
		this._skipOneCycleIfOddFrameAndBackgroundOn();

		if (this.cycle > LAST_CYCLE) {
			this.cycle = 0;
			this.scanline++;

			if (this.scanline > LAST_SCANLINE) {
				this.scanline = 0;
				this.frame++;
			}
		}
	}

	_skipOneCycleIfOddFrameAndBackgroundOn() {
		if (
			this.scanline === LAST_SCANLINE &&
			this.cycle === LAST_CYCLE &&
			this.ppuMask.showBackground &&
			this.frame % 2 === 1
		) {
			this.cycle++;
		}
	}

	_reset() {
		this.frame = 0;
		this.scanline = LAST_SCANLINE;
		this.cycle = 0;

		this.registers.ppuStatus.value = INITIAL_PPUSTATUS;

		this.internal.v = 0;
		this.internal.t = 0;
		this.internal.y = 0;
		this.internal.x = 0;
		this.internal.w = 0;
		this.internal.register = 0;
		this.internal.registerRead = 0;
		this.internal.registerBuffer = 0;
		this.internal.render.backgroundTileBuffer = [];
		this.internal.render.lowTileByte = 0;
		this.internal.render.highTileByte = 0;
		this.internal.render.attributeTableByte = 0;
		this.internal.render.spriteCount = 0;
		this.internal.render.sprites = new Array(SPRITES_PER_SCANLINE);
		for (var i = 0; i < SPRITES_PER_SCANLINE; i++) {
			this.internal.render.sprites[i] = {
				buffer: [],
				x: null,
				priority: null,
				index: null
			};
		}

		this.flags.isFrameReady = false;
		this.flags.nmiOccurred = false;

		this._cycleType = null;
		this._scanlineType = null;
	}

	get _isRenderingEnabled() {
		return (
			this.registers.ppuMask.showBackground ||
			this.registers.ppuMask.showSprites
		);
	}
}
