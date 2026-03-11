import * as binary from '@isopodlabs/binary'

enum FLAGS {
	NONE					= 0,
	ENCRYPTION				= 1 <<  0,
	OPTION1 				= 1 <<  1,
	OPTION2 				= 1 <<  2,
	HAS_DATADESCRIPTOR		= 1 <<  3,
	ENHANCED_DEFLATION		= 1 <<  4,
	COMPRESSED_PATCHED_DATA	= 1 <<  5,
	STRONG_ENCRYPTION		= 1 <<  6,
	LANGUAGE_ENCODING		= 1 << 11,
	MASK_HEADER_VALUES		= 1 << 13,
}
const enum METHOD {
	NO_COMPRESSION			= 0,
	SHRUNK					= 1,
	FACTOR1					= 2,
	FACTOR2					= 3,
	FACTOR3					= 4,
	FACTOR4					= 5,
	IMPLODED				= 6,
	DEFLATED				= 8,
	ENHANCED_DEFLATED		= 9,
	PKWARE_DCL_IMPLODED		= 10,
	BZIP2					= 12,
	LZMA					= 14,
	IBM_TERSE				= 18,
	IBM_LZ77Z				= 19,
	PPMD_I1					= 98,
}
const enum extensions {
	ZIP64					= 1,
}

class _time extends Date {
	constructor(x: number) {
		const c = binary.BitFields({seconds2:5, minute:6, hour:5})(x);
		super(0, 0, 0, c.minute * 2, c.hour * 2, c.seconds2 * 2);
	}
	toString()	{ return super.toString(); }
}

const time = binary.as(binary.UINT16_LE, _time);

class _date extends Date {
	constructor(x: number) {
		const c = binary.BitFields({day:5, month:4, years1980:7})(x);
		super(c.years1980 + 1980, c.month, c.day);
	}
	toString()	{ return super.toString(); }
}
const date = binary.as(binary.UINT16_LE, _date);

const signature = binary.UINT32_LE;

const extension = {
	id:		binary.UINT16_LE,
	size:	binary.UINT16_LE,
};
//		extension(uint16 id, size_t size) : id(id), size(uint16(size - sizeof(*this))) {}
//		const extension	*next()	const	{ return (const extension*)((uint8*)(this + 1) + size); }

const extension_zip64 = {...extension,
	uncompressed_size:	binary.UINT64_LE,
	compressed_size:	binary.UINT64_LE,
	offset:				binary.UINT64_LE,
	disk:				binary.UINT32_LE,
//	extension_zip64(uint64 uncompressed_size, uint64 compressed_size, uint64 offset, uint32 disk = 0) : extension(ZIP64, sizeof(*this)),
//		uncompressed_size(uncompressed_size), compressed_size(compressed_size), offset(offset), disk(disk)
//	{}
};

const file_header = {
	//enum {sig = 0x04034b50};
	//static const uint16 VERSION = 0x14;
	version:			binary.UINT16_LE,
	flag:				binary.Flags(FLAGS, true),
	method:				binary.UINT16_LE,//METHOD;
	mod_time:			time,
	mod_date:			date,
	crc:				binary.UINT32_LE,
	compressed_size:	binary.UINT32_LE,
	uncompressed_size:	binary.UINT32_LE,
	filename_length:	binary.UINT16_LE,
	extrafield_length:	binary.UINT16_LE,
};

const datadescriptor = {
	//enum {sig = 0x08074b50};
	crc:              	binary.UINT32_LE,
	compressed_size:  	binary.UINT32_LE,
	uncompressed_size:	binary.UINT32_LE,
};

const centraldir_entry = {
	//enum {sig = 0x02014b50};
	madeby:                  	binary.UINT16_LE,
	header:                  	file_header,
	comment_length:          	binary.UINT16_LE,
	disk_number_start:       	binary.UINT16_LE,
	internal_file_attributes:	binary.UINT16_LE,
	external_file_attributes:	binary.UINT32_LE,
	offset:                  	binary.UINT32_LE,
//	uint32				size()		const	{ return sizeof(*this) + header.filename_length + header.extrafield_length + comment_length; }
//	count_string		filename()	const	{ return count_string((char*)(this + 1), header.filename_length); }
//	const signature*	next()		const	{ return (const signature*)((char*)this + size()); }
};

const centraldir_end = {
	//enum {sig = 0x06054b50};
	disk_no:       	binary.UINT16_LE,
	dir_disk:      	binary.UINT16_LE,
	total_disk:    	binary.UINT16_LE,
	total_entries: 	binary.UINT16_LE,
	dir_size:      	binary.UINT32_LE,
	dir_offset:    	binary.UINT32_LE,
	comment_length:	binary.UINT16_LE,
};

const centraldir_ptr64 = {
	//enum {sig = 0x07064b50};
	disk:     		binary.UINT32_LE,
	offset:   		binary.UINT64_LE,
	num_disks:		binary.UINT32_LE,
};

const centraldir_end64 = {
	//enum {sig = 0x06064b50};
	size:         	binary.UINT64_LE,
	madeby:       	binary.UINT16_LE,
	version:      	binary.UINT16_LE,
	disk_no:      	binary.UINT32_LE,
	dir_disk:     	binary.UINT32_LE,
	total_disk:   	binary.UINT64_LE,
	total_entries:	binary.UINT64_LE,
	dir_size:     	binary.UINT64_LE,
	dir_offset:   	binary.UINT64_LE,
	//56	n	Comment (up to the size of EOCD64)
};
/*
template<typename T> struct with_signature : signature, T {
	with_signature() : signature(T::sig) {}
	bool	valid() const { return _sig == T::sig; }
	const with_signature *next() const { return static_cast<const with_signature*>(T::next()); }
};
*/

function CRC32_calc(crc: number, i: number) {
	crc ^= i;
	for (let k = 0; k < 8; k++)
		crc = crc & 1 ? (crc >> 1) ^ 0xedb88320 : crc >> 1;
	return crc;
}

class encryption {
	K0	= 0x12345678;
	K1	= 0x23456789;
	K2	= 0x34567890;
	constructor(password: string) {
		for (const i of password)
			this.update_keys(i.charCodeAt(0));
	}
	update_keys(i: number) {
		this.K0	= CRC32_calc(this.K0, i);
		this.K1	= (this.K1 + (this.K0 & 0xff)) * 134775813 + 1;
		this.K2	= CRC32_calc(this.K2, this.K1 >> 24);
	}
	decrypt_byte() {
		const temp = this.K2 | 2;
		return (temp * (temp ^ 1)) >> 8;
	}
	decrypt(r: Uint8Array) {
		for (const i in r) {
			const c	= r[i];
			r[i]	= c ^ this.decrypt_byte();
			this.update_keys(c);
		}
	}
}

/*
class decrypt_stream extends binary.stream {
	constructor(stream: binary.stream, private ze: encryption) {
		super(stream);
	}
	read_buffer(len: number) {
		const buffer = super.read_buffer(len);
		for (const i in buffer) {
			buffer[i] = buffer[i]^ this.ze.decrypt_byte();
			this.ze.update_keys(buffer[i]);
		}
		return buffer;
	}
};

class encrypt_stream extends binary.stream {
	temp = new Uint8Array(1024);
	constructor(stream: binary.stream, private ze: encryption) {
		super(stream);
	}
	write_buffer(buffer: Uint8Array) {
		for (let total = 0; total < buffer.length;) {
			const	n = Math.min(buffer.length - total, 1024);
			for (let i = 0; i < n; i++) {
				const	c		= buffer[i];
				this.temp[i]	= c ^ this.ze.decrypt_byte();
				this.ze.update_keys(c);
			}
			super.write_buffer(this.temp.subarray(0, n));
			total	+= n;
		}
	}
};

function search_for_sig(r: binary.stream, pos: number, sig: number, size: number) {
	char	buffer[2][256];
	for (int i = 0; (pos -= 256) > 0; i = 1 - i) {
		r.seek(pos);
		if (!r.read(buffer[i]))
			break;
		for (int j = 256 - 4 - size; j >= 0; --j) {
			if (*(packed<uint32>*)(buffer[i] + j) == sig)
				return pos + j;
		}
	}
	return 0;
}

function get_central_dir(istream_ref r, uint64 *length) {
	char	buffer[256];
	for (streamptr pos = r.length(); (pos -= 256) > 0; ) {
		r.seek(pos);
		if (!r.read(buffer))
			break;
		for (int j = 256 - 4; j >= 0; --j) {
			auto	sig = *(packed<uint32>*)(buffer + j);
			if (sig == centraldir_end::sig) {
				r.seek(pos + j + 4);
				auto	end = r.get<centraldir_end>();
				if (~end.dir_offset) {
					if (length)
						*length = end.dir_size;
					return end.dir_offset;
				}
			} else if (sig == centraldir_ptr64::sig) {
				r.seek(pos + j + 4);
				auto	ptr = r.get<centraldir_ptr64>();
				r.seek(ptr.offset + 4);

			//} else if (sig == centraldirend64::sig) {
			//	r.seek(pos + j + 4);
				auto	end = r.get<centraldir_end64>();
				if (length)
					*length = end.dir_size;
				return end.dir_offset;
			}
		}
	}
	return 0;
}

class ZIPfile0 {
public:
	uint64		compressed_size;
	uint64		uncompressed_size;
	FLAGS		flags;
	METHOD		method;
	uint32		crc;
	DateTime	mod;

	malloc_block	_Extract(istream_ref r) const {
		return malloc_block(r, uncompressed_size);
	}
	bool			_Extract(ostream_ref w, istream_ref r) const {
		return stream_copy<1024>(w, r, uncompressed_size) == uncompressed_size;
	}
	istream_ptr		_Reader(istream_ref file) const {
		switch (method) {
			default:
			case NO_COMPRESSION:	return new istream_offset(copy(file), uncompressed_size);
			case DEFLATED:			return new deflate_reader(file, uncompressed_size);
		#ifdef BZ2_STREAM_H
			case BZIP2:				return new BZ2istream(file, uncompressed_size);
		#endif
		}
	}
	public:
	malloc_block	Extract(istream_ref r) const {
		switch (method) {
			case NO_COMPRESSION:	return _Extract(r);
			case DEFLATED:			return _Extract(deflate_reader(r));
		#ifdef BZ2_STREAM_H
			case BZIP2:				return _Extract(BZ2istream(r, uncompressed_size));
		#endif
			default:				return none;
		}
	}
	bool			Extract(ostream_ref w, istream_ref r) const {
		if (w.exists()) switch (method) {
			case NO_COMPRESSION:	return _Extract(w, r);
			case DEFLATED:			return _Extract(w, deflate_reader(r));
		#ifdef BZ2_STREAM_H
			case BZIP2:				return _Extract(w, BZ2istream(r, uncompressed_size));
		#endif
			default:				break;
		}
		return false;
	}
	bool			Extract(const char *fn, istream_ref r) const {
		return Extract(FileOutput(fn), r);
	}
	istream_ptr		Reader(istream_ref r, const char *password = 0) const {
		if (!(flags & ENCRYPTION))
			return _Reader(r);

		if (password) {
			encryption	ze(password);
			char		buffer[12];
			r.readbuff(buffer, 12);
			for (int i = 0; i < 12; i++)
				ze.update_keys(buffer[i] ^= ze.decrypt_byte());
			if (uint8(buffer[11]) == crc >> 24)
				return new decrypt_stream(_Reader(r), ze);
		}
		return none;
	}
	uint32			Length()		const { return uncompressed_size; }
	bool			Encrypted()		const { return !!(flags & ENCRYPTION); }
	bool			UnknownSize()	const { return !~uncompressed_size || (flags & HAS_DATADESCRIPTOR); }
};

class ZIPfile extends ZIPfile0 {
	filename	fn;

	ZIPfile()	{}
	ZIPfile(const char *fn) : fn(fn) {}
	ZIPfile(istream_ref file, const centraldir_entry *cd) { InitFromCD(file, cd); }

	streamptr	InitFromLocal(istream_ref file) {
		auto	h	= file.get<file_header>();

		if (h.filename_length >= sizeof(fn))
			return 0;

		file.readbuff(fn, h.filename_length);
		fn[h.filename_length] = 0;

		compressed_size		= h.compressed_size;
		uncompressed_size	= h.uncompressed_size;
		flags				= h.flag;
		method				= h.method;
		crc					= h.crc;
		mod					= DateTime(Date(h.mod_date)) + TimeOfDay(h.mod_time);

		auto	extra = malloc_block(file, h.extrafield_length);
		for (auto& i : make_next_range<const extension>(extra)) {
			if (i.id == ZIP64) {
				auto	x = (extension_zip64*)&i;
				compressed_size		= x->compressed_size;
				uncompressed_size	= x->uncompressed_size;
			}
		}
		return file.tell() + (~compressed_size ? compressed_size : 0);
	}
	void		InitFromCD(istream_ref file, const centraldir_entry *cd) {
		fn = cd->filename();

		file.seek(cd->offset);
		if (file.get<uint32le>() == file_header::sig) {
			auto	h	= file.get<file_header>();
			compressed_size		= cd->header.compressed_size;
			uncompressed_size	= cd->header.uncompressed_size;
			file.seek_cur(h.filename_length + h.extrafield_length);
		}
	}
	streamptr	InitFromCD(istream_ref file) {
		auto	cd = file.get<centraldir_entry>();
		file.readbuff(fn, cd.header.filename_length);
		fn[cd.header.filename_length] = 0;

		compressed_size		= cd.header.compressed_size;
		uncompressed_size	= cd.header.uncompressed_size;
		
		uint64	offset		= cd.offset;
		auto	extra		= malloc_block(file, cd.header.extrafield_length);
		for (auto& i : make_next_range<const extension>(extra)) {
			if (i.id == ZIP64) {
				auto	x = (extension_zip64*)&i;
				compressed_size		= x->compressed_size;
				uncompressed_size	= x->uncompressed_size;
				offset				= x->offset;
			}
		}

		streamptr	next = file.tell() + cd.comment_length;
		file.seek(offset);
		
		if (file.get<uint32le>() != file_header::sig)
			return 0;

		auto	h	= file.get<file_header>();
		flags		= h.flag;
		method		= h.method;
		crc			= h.crc;
		file.seek_cur(h.filename_length + h.extrafield_length);
		return next;
	}
};


class ZIPreader {
	istream_ref	file;
	streamptr	next;
	uint32		sig;
	bool		datadesc;

	public:
	ZIPreader(istream_ref file) : file(file), next(0), sig(0), datadesc(false) {}
	bool		Next(ZIPfile &zf) {
		file.seek(next);
		if (datadesc) {
			if (file.get<uint32le>() != datadescriptor::sig)
				file.seek_cur(-4);
			datadescriptor	dd = file.get();
			unused(dd);
		}
		if ((sig = file.get<uint32le>()) != file_header::sig || !(next = zf.InitFromLocal(file)))
			return false;

		datadesc	= !!(zf.flags & HAS_DATADESCRIPTOR);
		return true;
	}
};

class ZIPreaderCD {
	istream_ref	file;
	streamptr	next;
	uint32		sig;

	public:
	ZIPreaderCD(istream_ref file) : file(file), next(get_central_dir(file, nullptr)), sig(0) {}
	operator bool() const { return !!next; }

	bool	Next(ZIPfile &zf) {
		file.seek(next);
		sig		= file.get<uint32le>();
		if (sig != centraldir_entry::sig)
			return false;

		next	= zf.InitFromCD(file);
		return !!next;
	}
};

class ZIPreaderCD2 {
	malloc_block	cd;
	dynamic_array<holder<const centraldir_entry&>>	entries;
	public:
	ZIPreaderCD2(istream_ref file) {
		uint64	len = 0;
		if (streamptr pos = get_central_dir(file, &len)) {
			file.seek(pos);
			cd = malloc_block(file, len);
			entries = make_next_range<const with_signature<centraldir_entry>>(cd);

		}
	}

	const centraldir_entry	*Find(const char *filename) {
		auto	i = lower_boundc(entries, filename, [](const centraldir_entry &cd, const char *filename) {
			return cd.filename() < filename;
		});
		if (i != entries.end() && (*i)->filename() == filename)
			return &*i;
		return 0;
	}
};

class ZIPwriter {
	struct Entry : ZIPfile {
		uint64		offset;
		Entry(const char *name) : ZIPfile(name) {}
		bool operator<(const Entry &b) const { return fn < b.fn; }
		bool	WriteLocal(ostream_ref file);
		bool	WriteCD(ostream_ref file);
	};
	ostream_ref				file;
	dynamic_array<Entry>	centraldir;
	public:
	ZIPwriter(ostream_ref file) : file(file) {}
	~ZIPwriter();

	void Write(const char *name, const_memory_block data, const DateTime &mod = DateTime::Now(), const char* password = 0, const char* random = 0);
};
*/
