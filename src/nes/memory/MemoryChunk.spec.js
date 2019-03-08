import { MemoryChunk } from ".";
import { Buffer } from "buffer";
const should = require("chai").Should();

describe("memory", () => {
	describe("MemoryChunk", () => {
		let buffer, chunk;

		beforeEach(() => {
			buffer = Buffer.alloc(5);
			chunk = new MemoryChunk(buffer, 29);
		});

		it("can create a chunk just passing the number of bytes", () => {
			new MemoryChunk(5).getBytes().length.should.equal(5);
		});

		it("can write and read bytes", () => {
			chunk.writeAt(2, 123);
			chunk.readAt(2).should.equal(123);
		});

		it("can read and write numbers in Little Endian", () => {
			chunk.writeAt(0, 0x20);
			chunk.writeAt(1, 0xff);
			chunk.write2BytesAt(2, 0xfe30);

			chunk.readBytesAt(0, 1).should.equal(0x20);
			chunk.readBytesAt(1, 1).should.equal(0xff);
			chunk.readBytesAt(0, 2).should.equal(0xff20);
			chunk.read2BytesAt(0).should.equal(0xff20);
			chunk.read2BytesAt(2).should.equal(0xfe30);
		});

		it("can return the memory buffer", () => {
			(chunk.getBytes() === buffer).should.ok;
		});

		it("can return the size of the buffer", () => {
			chunk.memorySize.should.equal(5);
		});

		it("throws an exception when the address is out of bounds", () => {
			(() => chunk.writeAt(9, 123)).should.throw(
				"Invalid memory access at 0x9"
			);
		});
	});
});
