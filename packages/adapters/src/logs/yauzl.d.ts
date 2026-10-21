declare module "yauzl" {
 import {EventEmitter} from "node:events";
 import type {Readable} from "node:stream";
 export interface Entry {fileName:string;uncompressedSize:number;compressedSize:number;generalPurposeBitFlag:number;externalFileAttributes:number;compressionMethod:number;crc32:number}
 export class ZipFile extends EventEmitter {readEntry():void;close():void;openReadStream(entry:Entry,callback:(error:Error|null,stream:Readable)=>void):void}
 export function open(path:string,options:{lazyEntries:boolean;validateEntrySizes:boolean;strictFileNames:boolean;autoClose:boolean},callback:(error:Error|null,zip:ZipFile)=>void):void;
}
