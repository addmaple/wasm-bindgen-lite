//! SIMD Detector CLI
//!
//! Analyzes WebAssembly files for SIMD instruction usage and maps
//! instructions back to Rust source code using DWARF debug info.

use addr2line::Context;
use clap::Parser;
use gimli::{EndianSlice, LittleEndian};
use object::{Object, ObjectSection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use wasmparser::{BinaryReaderError, Operator, Parser as WasmParser, Payload};

#[derive(Parser, Debug)]
#[command(name = "simd-detect")]
#[command(about = "Detect SIMD instructions in WebAssembly and map to source")]
struct Args {
    /// Path to the .wasm file to analyze
    #[arg(required = true)]
    wasm_file: PathBuf,

    /// Variant name (for report labeling)
    #[arg(short, long, default_value = "unknown")]
    variant: String,

    /// Output JSON file path
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Print verbose output
    #[arg(short = 'V', long)]
    verbose: bool,
}

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
struct SimdOpInfo {
    opcode: String,
    count: u32,
}

#[derive(Debug, Clone, Serialize)]
struct FunctionInfo {
    index: u32,
    name: Option<String>,
    file: Option<String>,
    line: Option<u32>,
    simd_ops_total: u32,
    total_ops: u32,
    simd_density: f64,
    op_breakdown: HashMap<String, u32>,
}

#[derive(Debug, Clone, Serialize)]
struct LineInfo {
    file: String,
    line: u32,
    simd_ops_total: u32,
    breakdown: HashMap<String, u32>,
}

#[derive(Debug, Serialize)]
struct SimdReport {
    variant: String,
    wasm_path: String,
    wasm_hash: String,
    wasm_size: usize,
    total_simd_ops: u32,
    total_ops: u32,
    overall_simd_density: f64,
    opcode_summary: HashMap<String, u32>,
    functions: Vec<FunctionInfo>,
    lines: Vec<LineInfo>,
}

/// Categorize WASM operator as SIMD or not, return opcode name if SIMD
fn classify_simd_op(op: &Operator) -> Option<&'static str> {
    use Operator::*;

    match op {
        // v128 loads and stores
        V128Load { .. } => Some("v128.load"),
        V128Load8x8S { .. } => Some("v128.load8x8_s"),
        V128Load8x8U { .. } => Some("v128.load8x8_u"),
        V128Load16x4S { .. } => Some("v128.load16x4_s"),
        V128Load16x4U { .. } => Some("v128.load16x4_u"),
        V128Load32x2S { .. } => Some("v128.load32x2_s"),
        V128Load32x2U { .. } => Some("v128.load32x2_u"),
        V128Load8Splat { .. } => Some("v128.load8_splat"),
        V128Load16Splat { .. } => Some("v128.load16_splat"),
        V128Load32Splat { .. } => Some("v128.load32_splat"),
        V128Load64Splat { .. } => Some("v128.load64_splat"),
        V128Load32Zero { .. } => Some("v128.load32_zero"),
        V128Load64Zero { .. } => Some("v128.load64_zero"),
        V128Store { .. } => Some("v128.store"),
        V128Load8Lane { .. } => Some("v128.load8_lane"),
        V128Load16Lane { .. } => Some("v128.load16_lane"),
        V128Load32Lane { .. } => Some("v128.load32_lane"),
        V128Load64Lane { .. } => Some("v128.load64_lane"),
        V128Store8Lane { .. } => Some("v128.store8_lane"),
        V128Store16Lane { .. } => Some("v128.store16_lane"),
        V128Store32Lane { .. } => Some("v128.store32_lane"),
        V128Store64Lane { .. } => Some("v128.store64_lane"),

        // v128 constant and shuffle
        V128Const { .. } => Some("v128.const"),
        I8x16Shuffle { .. } => Some("i8x16.shuffle"),

        // i8x16 operations
        I8x16Splat => Some("i8x16.splat"),
        I8x16ExtractLaneS { .. } => Some("i8x16.extract_lane_s"),
        I8x16ExtractLaneU { .. } => Some("i8x16.extract_lane_u"),
        I8x16ReplaceLane { .. } => Some("i8x16.replace_lane"),
        I8x16Swizzle => Some("i8x16.swizzle"),
        I8x16Eq => Some("i8x16.eq"),
        I8x16Ne => Some("i8x16.ne"),
        I8x16LtS => Some("i8x16.lt_s"),
        I8x16LtU => Some("i8x16.lt_u"),
        I8x16GtS => Some("i8x16.gt_s"),
        I8x16GtU => Some("i8x16.gt_u"),
        I8x16LeS => Some("i8x16.le_s"),
        I8x16LeU => Some("i8x16.le_u"),
        I8x16GeS => Some("i8x16.ge_s"),
        I8x16GeU => Some("i8x16.ge_u"),
        I8x16Abs => Some("i8x16.abs"),
        I8x16Neg => Some("i8x16.neg"),
        I8x16Popcnt => Some("i8x16.popcnt"),
        I8x16AllTrue => Some("i8x16.all_true"),
        I8x16Bitmask => Some("i8x16.bitmask"),
        I8x16NarrowI16x8S => Some("i8x16.narrow_i16x8_s"),
        I8x16NarrowI16x8U => Some("i8x16.narrow_i16x8_u"),
        I8x16Shl => Some("i8x16.shl"),
        I8x16ShrS => Some("i8x16.shr_s"),
        I8x16ShrU => Some("i8x16.shr_u"),
        I8x16Add => Some("i8x16.add"),
        I8x16AddSatS => Some("i8x16.add_sat_s"),
        I8x16AddSatU => Some("i8x16.add_sat_u"),
        I8x16Sub => Some("i8x16.sub"),
        I8x16SubSatS => Some("i8x16.sub_sat_s"),
        I8x16SubSatU => Some("i8x16.sub_sat_u"),
        I8x16MinS => Some("i8x16.min_s"),
        I8x16MinU => Some("i8x16.min_u"),
        I8x16MaxS => Some("i8x16.max_s"),
        I8x16MaxU => Some("i8x16.max_u"),
        I8x16AvgrU => Some("i8x16.avgr_u"),

        // i16x8 operations
        I16x8Splat => Some("i16x8.splat"),
        I16x8ExtractLaneS { .. } => Some("i16x8.extract_lane_s"),
        I16x8ExtractLaneU { .. } => Some("i16x8.extract_lane_u"),
        I16x8ReplaceLane { .. } => Some("i16x8.replace_lane"),
        I16x8Eq => Some("i16x8.eq"),
        I16x8Ne => Some("i16x8.ne"),
        I16x8LtS => Some("i16x8.lt_s"),
        I16x8LtU => Some("i16x8.lt_u"),
        I16x8GtS => Some("i16x8.gt_s"),
        I16x8GtU => Some("i16x8.gt_u"),
        I16x8LeS => Some("i16x8.le_s"),
        I16x8LeU => Some("i16x8.le_u"),
        I16x8GeS => Some("i16x8.ge_s"),
        I16x8GeU => Some("i16x8.ge_u"),
        I16x8Abs => Some("i16x8.abs"),
        I16x8Neg => Some("i16x8.neg"),
        I16x8AllTrue => Some("i16x8.all_true"),
        I16x8Bitmask => Some("i16x8.bitmask"),
        I16x8NarrowI32x4S => Some("i16x8.narrow_i32x4_s"),
        I16x8NarrowI32x4U => Some("i16x8.narrow_i32x4_u"),
        I16x8ExtendLowI8x16S => Some("i16x8.extend_low_i8x16_s"),
        I16x8ExtendHighI8x16S => Some("i16x8.extend_high_i8x16_s"),
        I16x8ExtendLowI8x16U => Some("i16x8.extend_low_i8x16_u"),
        I16x8ExtendHighI8x16U => Some("i16x8.extend_high_i8x16_u"),
        I16x8Shl => Some("i16x8.shl"),
        I16x8ShrS => Some("i16x8.shr_s"),
        I16x8ShrU => Some("i16x8.shr_u"),
        I16x8Add => Some("i16x8.add"),
        I16x8AddSatS => Some("i16x8.add_sat_s"),
        I16x8AddSatU => Some("i16x8.add_sat_u"),
        I16x8Sub => Some("i16x8.sub"),
        I16x8SubSatS => Some("i16x8.sub_sat_s"),
        I16x8SubSatU => Some("i16x8.sub_sat_u"),
        I16x8Mul => Some("i16x8.mul"),
        I16x8MinS => Some("i16x8.min_s"),
        I16x8MinU => Some("i16x8.min_u"),
        I16x8MaxS => Some("i16x8.max_s"),
        I16x8MaxU => Some("i16x8.max_u"),
        I16x8AvgrU => Some("i16x8.avgr_u"),
        I16x8ExtMulLowI8x16S => Some("i16x8.extmul_low_i8x16_s"),
        I16x8ExtMulHighI8x16S => Some("i16x8.extmul_high_i8x16_s"),
        I16x8ExtMulLowI8x16U => Some("i16x8.extmul_low_i8x16_u"),
        I16x8ExtMulHighI8x16U => Some("i16x8.extmul_high_i8x16_u"),
        I16x8ExtAddPairwiseI8x16S => Some("i16x8.extadd_pairwise_i8x16_s"),
        I16x8ExtAddPairwiseI8x16U => Some("i16x8.extadd_pairwise_i8x16_u"),
        I16x8Q15MulrSatS => Some("i16x8.q15mulr_sat_s"),

        // i32x4 operations
        I32x4Splat => Some("i32x4.splat"),
        I32x4ExtractLane { .. } => Some("i32x4.extract_lane"),
        I32x4ReplaceLane { .. } => Some("i32x4.replace_lane"),
        I32x4Eq => Some("i32x4.eq"),
        I32x4Ne => Some("i32x4.ne"),
        I32x4LtS => Some("i32x4.lt_s"),
        I32x4LtU => Some("i32x4.lt_u"),
        I32x4GtS => Some("i32x4.gt_s"),
        I32x4GtU => Some("i32x4.gt_u"),
        I32x4LeS => Some("i32x4.le_s"),
        I32x4LeU => Some("i32x4.le_u"),
        I32x4GeS => Some("i32x4.ge_s"),
        I32x4GeU => Some("i32x4.ge_u"),
        I32x4Abs => Some("i32x4.abs"),
        I32x4Neg => Some("i32x4.neg"),
        I32x4AllTrue => Some("i32x4.all_true"),
        I32x4Bitmask => Some("i32x4.bitmask"),
        I32x4ExtendLowI16x8S => Some("i32x4.extend_low_i16x8_s"),
        I32x4ExtendHighI16x8S => Some("i32x4.extend_high_i16x8_s"),
        I32x4ExtendLowI16x8U => Some("i32x4.extend_low_i16x8_u"),
        I32x4ExtendHighI16x8U => Some("i32x4.extend_high_i16x8_u"),
        I32x4Shl => Some("i32x4.shl"),
        I32x4ShrS => Some("i32x4.shr_s"),
        I32x4ShrU => Some("i32x4.shr_u"),
        I32x4Add => Some("i32x4.add"),
        I32x4Sub => Some("i32x4.sub"),
        I32x4Mul => Some("i32x4.mul"),
        I32x4MinS => Some("i32x4.min_s"),
        I32x4MinU => Some("i32x4.min_u"),
        I32x4MaxS => Some("i32x4.max_s"),
        I32x4MaxU => Some("i32x4.max_u"),
        I32x4DotI16x8S => Some("i32x4.dot_i16x8_s"),
        I32x4ExtMulLowI16x8S => Some("i32x4.extmul_low_i16x8_s"),
        I32x4ExtMulHighI16x8S => Some("i32x4.extmul_high_i16x8_s"),
        I32x4ExtMulLowI16x8U => Some("i32x4.extmul_low_i16x8_u"),
        I32x4ExtMulHighI16x8U => Some("i32x4.extmul_high_i16x8_u"),
        I32x4ExtAddPairwiseI16x8S => Some("i32x4.extadd_pairwise_i16x8_s"),
        I32x4ExtAddPairwiseI16x8U => Some("i32x4.extadd_pairwise_i16x8_u"),
        I32x4TruncSatF32x4S => Some("i32x4.trunc_sat_f32x4_s"),
        I32x4TruncSatF32x4U => Some("i32x4.trunc_sat_f32x4_u"),
        I32x4TruncSatF64x2SZero => Some("i32x4.trunc_sat_f64x2_s_zero"),
        I32x4TruncSatF64x2UZero => Some("i32x4.trunc_sat_f64x2_u_zero"),

        // i64x2 operations
        I64x2Splat => Some("i64x2.splat"),
        I64x2ExtractLane { .. } => Some("i64x2.extract_lane"),
        I64x2ReplaceLane { .. } => Some("i64x2.replace_lane"),
        I64x2Eq => Some("i64x2.eq"),
        I64x2Ne => Some("i64x2.ne"),
        I64x2LtS => Some("i64x2.lt_s"),
        I64x2GtS => Some("i64x2.gt_s"),
        I64x2LeS => Some("i64x2.le_s"),
        I64x2GeS => Some("i64x2.ge_s"),
        I64x2Abs => Some("i64x2.abs"),
        I64x2Neg => Some("i64x2.neg"),
        I64x2AllTrue => Some("i64x2.all_true"),
        I64x2Bitmask => Some("i64x2.bitmask"),
        I64x2ExtendLowI32x4S => Some("i64x2.extend_low_i32x4_s"),
        I64x2ExtendHighI32x4S => Some("i64x2.extend_high_i32x4_s"),
        I64x2ExtendLowI32x4U => Some("i64x2.extend_low_i32x4_u"),
        I64x2ExtendHighI32x4U => Some("i64x2.extend_high_i32x4_u"),
        I64x2Shl => Some("i64x2.shl"),
        I64x2ShrS => Some("i64x2.shr_s"),
        I64x2ShrU => Some("i64x2.shr_u"),
        I64x2Add => Some("i64x2.add"),
        I64x2Sub => Some("i64x2.sub"),
        I64x2Mul => Some("i64x2.mul"),
        I64x2ExtMulLowI32x4S => Some("i64x2.extmul_low_i32x4_s"),
        I64x2ExtMulHighI32x4S => Some("i64x2.extmul_high_i32x4_s"),
        I64x2ExtMulLowI32x4U => Some("i64x2.extmul_low_i32x4_u"),
        I64x2ExtMulHighI32x4U => Some("i64x2.extmul_high_i32x4_u"),

        // f32x4 operations
        F32x4Splat => Some("f32x4.splat"),
        F32x4ExtractLane { .. } => Some("f32x4.extract_lane"),
        F32x4ReplaceLane { .. } => Some("f32x4.replace_lane"),
        F32x4Eq => Some("f32x4.eq"),
        F32x4Ne => Some("f32x4.ne"),
        F32x4Lt => Some("f32x4.lt"),
        F32x4Gt => Some("f32x4.gt"),
        F32x4Le => Some("f32x4.le"),
        F32x4Ge => Some("f32x4.ge"),
        F32x4Abs => Some("f32x4.abs"),
        F32x4Neg => Some("f32x4.neg"),
        F32x4Sqrt => Some("f32x4.sqrt"),
        F32x4Add => Some("f32x4.add"),
        F32x4Sub => Some("f32x4.sub"),
        F32x4Mul => Some("f32x4.mul"),
        F32x4Div => Some("f32x4.div"),
        F32x4Min => Some("f32x4.min"),
        F32x4Max => Some("f32x4.max"),
        F32x4PMin => Some("f32x4.pmin"),
        F32x4PMax => Some("f32x4.pmax"),
        F32x4Ceil => Some("f32x4.ceil"),
        F32x4Floor => Some("f32x4.floor"),
        F32x4Trunc => Some("f32x4.trunc"),
        F32x4Nearest => Some("f32x4.nearest"),
        F32x4ConvertI32x4S => Some("f32x4.convert_i32x4_s"),
        F32x4ConvertI32x4U => Some("f32x4.convert_i32x4_u"),
        F32x4DemoteF64x2Zero => Some("f32x4.demote_f64x2_zero"),

        // f64x2 operations
        F64x2Splat => Some("f64x2.splat"),
        F64x2ExtractLane { .. } => Some("f64x2.extract_lane"),
        F64x2ReplaceLane { .. } => Some("f64x2.replace_lane"),
        F64x2Eq => Some("f64x2.eq"),
        F64x2Ne => Some("f64x2.ne"),
        F64x2Lt => Some("f64x2.lt"),
        F64x2Gt => Some("f64x2.gt"),
        F64x2Le => Some("f64x2.le"),
        F64x2Ge => Some("f64x2.ge"),
        F64x2Abs => Some("f64x2.abs"),
        F64x2Neg => Some("f64x2.neg"),
        F64x2Sqrt => Some("f64x2.sqrt"),
        F64x2Add => Some("f64x2.add"),
        F64x2Sub => Some("f64x2.sub"),
        F64x2Mul => Some("f64x2.mul"),
        F64x2Div => Some("f64x2.div"),
        F64x2Min => Some("f64x2.min"),
        F64x2Max => Some("f64x2.max"),
        F64x2PMin => Some("f64x2.pmin"),
        F64x2PMax => Some("f64x2.pmax"),
        F64x2Ceil => Some("f64x2.ceil"),
        F64x2Floor => Some("f64x2.floor"),
        F64x2Trunc => Some("f64x2.trunc"),
        F64x2Nearest => Some("f64x2.nearest"),
        F64x2ConvertLowI32x4S => Some("f64x2.convert_low_i32x4_s"),
        F64x2ConvertLowI32x4U => Some("f64x2.convert_low_i32x4_u"),
        F64x2PromoteLowF32x4 => Some("f64x2.promote_low_f32x4"),

        // v128 bitwise operations
        V128Not => Some("v128.not"),
        V128And => Some("v128.and"),
        V128AndNot => Some("v128.andnot"),
        V128Or => Some("v128.or"),
        V128Xor => Some("v128.xor"),
        V128Bitselect => Some("v128.bitselect"),
        V128AnyTrue => Some("v128.any_true"),

        // Not a SIMD operation
        _ => None,
    }
}

/// Parse function names from the name section
fn parse_name_section(data: &[u8]) -> HashMap<u32, String> {
    let mut names = HashMap::new();

    for payload in WasmParser::new(0).parse_all(data) {
        if let Ok(Payload::CustomSection(section)) = payload {
            if section.name() == "name" {
                // Try to parse the name section using BinaryReader
                let reader = wasmparser::BinaryReader::new(section.data(), section.data_offset());
                let name_reader = wasmparser::NameSectionReader::new(reader);
                for name in name_reader {
                    if let Ok(wasmparser::Name::Function(fnames)) = name {
                        for fname in fnames {
                            if let Ok(naming) = fname {
                                names.insert(naming.index, naming.name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    names
}

/// Analyze a single function's code
fn analyze_function(
    _func_index: u32,
    code: &wasmparser::FunctionBody,
) -> Result<(u32, u32, HashMap<String, u32>), BinaryReaderError> {
    let mut total_ops = 0u32;
    let mut simd_ops = 0u32;
    let mut breakdown: HashMap<String, u32> = HashMap::new();

    let mut reader = code.get_operators_reader()?;
    while !reader.eof() {
        let op = reader.read()?;
        total_ops += 1;

        if let Some(opcode_name) = classify_simd_op(&op) {
            simd_ops += 1;
            *breakdown.entry(opcode_name.to_string()).or_insert(0) += 1;
        }
    }

    Ok((total_ops, simd_ops, breakdown))
}

/// Try to get source location from DWARF
fn get_source_location(
    ctx: Option<&Context<EndianSlice<LittleEndian>>>,
    code_offset: u64,
) -> (Option<String>, Option<u32>) {
    if let Some(ctx) = ctx {
        if let Ok(Some(loc)) = ctx.find_location(code_offset) {
            let file = loc.file.map(|f| f.to_string());
            let line = loc.line;
            return (file, line);
        }
    }
    (None, None)
}

fn analyze_wasm(args: &Args) -> Result<SimdReport, Box<dyn std::error::Error>> {
    let wasm_bytes = fs::read(&args.wasm_file)?;
    let wasm_hash = hex::encode(&Sha256::digest(&wasm_bytes)[..8]);

    // Parse name section for function names
    let func_names = parse_name_section(&wasm_bytes);

    // Try to load DWARF debug info
    let dwarf_ctx: Option<Context<EndianSlice<LittleEndian>>> = {
        let obj = object::File::parse(&*wasm_bytes).ok();
        obj.and_then(|obj| {
            let loader = |section: gimli::SectionId| -> Result<_, gimli::Error> {
                let data = obj
                    .section_by_name(section.name())
                    .and_then(|s| s.data().ok())
                    .unwrap_or(&[]);
                Ok(EndianSlice::new(data, LittleEndian))
            };
            let dwarf = gimli::Dwarf::load(loader).ok()?;
            Context::from_dwarf(dwarf).ok()
        })
    };

    let has_dwarf = dwarf_ctx.is_some();
    if args.verbose {
        eprintln!(
            "DWARF debug info: {}",
            if has_dwarf { "found" } else { "not found" }
        );
    }

    // Parse and analyze WASM
    let mut functions: Vec<FunctionInfo> = Vec::new();
    let mut lines_map: HashMap<(String, u32), HashMap<String, u32>> = HashMap::new();
    let mut opcode_summary: HashMap<String, u32> = HashMap::new();
    let mut total_simd_ops = 0u32;
    let mut total_ops = 0u32;

    let mut func_index = 0u32;
    let mut code_section_offset = 0u64;

    for payload in WasmParser::new(0).parse_all(&wasm_bytes) {
        match payload? {
            Payload::CodeSectionStart { range, .. } => {
                code_section_offset = range.start as u64;
            }
            Payload::CodeSectionEntry(code) => {
                let (ops, simd, breakdown) = analyze_function(func_index, &code)?;

                total_ops += ops;
                total_simd_ops += simd;

                // Merge into opcode summary
                for (op, count) in &breakdown {
                    *opcode_summary.entry(op.clone()).or_insert(0) += count;
                }

                // Get source location
                let code_offset = code_section_offset + code.range().start as u64;
                let (file, line) = get_source_location(dwarf_ctx.as_ref(), code_offset);

                // Merge into lines map
                if let (Some(f), Some(l)) = (&file, line) {
                    let key = (f.clone(), l);
                    let entry = lines_map.entry(key).or_default();
                    for (op, count) in &breakdown {
                        *entry.entry(op.clone()).or_insert(0) += count;
                    }
                }

                let density = if ops > 0 {
                    simd as f64 / ops as f64
                } else {
                    0.0
                };

                functions.push(FunctionInfo {
                    index: func_index,
                    name: func_names.get(&func_index).cloned(),
                    file,
                    line,
                    simd_ops_total: simd,
                    total_ops: ops,
                    simd_density: density,
                    op_breakdown: breakdown,
                });

                func_index += 1;
            }
            _ => {}
        }
    }

    // Convert lines map to vec
    let lines: Vec<LineInfo> = lines_map
        .into_iter()
        .filter(|(_, breakdown)| !breakdown.is_empty())
        .map(|((file, line), breakdown)| {
            let simd_ops_total = breakdown.values().sum();
            LineInfo {
                file,
                line,
                simd_ops_total,
                breakdown,
            }
        })
        .collect();

    // Filter to only functions with SIMD, sort by SIMD density
    let mut simd_functions: Vec<_> = functions
        .into_iter()
        .filter(|f| f.simd_ops_total > 0)
        .collect();
    simd_functions.sort_by(|a, b| b.simd_density.partial_cmp(&a.simd_density).unwrap());

    let overall_density = if total_ops > 0 {
        total_simd_ops as f64 / total_ops as f64
    } else {
        0.0
    };

    Ok(SimdReport {
        variant: args.variant.clone(),
        wasm_path: args.wasm_file.display().to_string(),
        wasm_hash,
        wasm_size: wasm_bytes.len(),
        total_simd_ops,
        total_ops,
        overall_simd_density: overall_density,
        opcode_summary,
        functions: simd_functions,
        lines,
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    if args.verbose {
        eprintln!("Analyzing: {}", args.wasm_file.display());
    }

    let report = analyze_wasm(&args)?;

    let json = serde_json::to_string_pretty(&report)?;

    if let Some(output_path) = &args.output {
        fs::write(output_path, &json)?;
        eprintln!("Wrote report to: {}", output_path.display());
    } else {
        println!("{}", json);
    }

    // Print summary to stderr
    eprintln!("\nSIMD Analysis Summary:");
    eprintln!("  Variant: {}", report.variant);
    eprintln!("  WASM hash: {}", report.wasm_hash);
    eprintln!(
        "  Total ops: {}, SIMD ops: {} ({:.1}%)",
        report.total_ops,
        report.total_simd_ops,
        report.overall_simd_density * 100.0
    );
    eprintln!("  Functions with SIMD: {}", report.functions.len());

    if !report.opcode_summary.is_empty() {
        eprintln!("\n  Top SIMD opcodes:");
        let mut opcodes: Vec<_> = report.opcode_summary.iter().collect();
        opcodes.sort_by(|a, b| b.1.cmp(a.1));
        for (op, count) in opcodes.iter().take(10) {
            eprintln!("    {}: {}", op, count);
        }
    }

    Ok(())
}
