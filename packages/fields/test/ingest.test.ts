import { describe, expect, it } from 'vitest';
import { type SourceInput, UngradedSourceError, assertGraded } from '../src/ingest.ts';

const valid: SourceInput = {
  fieldId: 'materials.metallurgy',
  uri: 'https://example.invalid/failure-analysis-2024.pdf',
  title: 'Failure analysis of a bonded joint',
  grading: { reliability: 'B', contentClass: 'curated', gradedBy: 'human:curator' },
  chunks: [
    {
      text: 'Disbond initiated at the bondline following a documented cure deviation.',
      credibility: 2,
      situationTags: ['cure_deviation', 'disbond'],
    },
  ],
};

describe('assertGraded', () => {
  it('accepts a fully graded source', () => {
    expect(() => assertGraded(valid)).not.toThrow();
  });

  describe('rejects ungraded input', () => {
    it('with no reliability grade at all', () => {
      // §E.2.1: grading is a required input assigned at curation time, not something the
      // pipeline infers. An inferred grade is the system scoring its own veracity.
      const ungraded = {
        ...valid,
        grading: { gradedBy: 'human:curator' },
      } as unknown as SourceInput;
      expect(() => assertGraded(ungraded)).toThrow(UngradedSourceError);
    });

    it('with a reliability outside A-F', () => {
      const source = { ...valid, grading: { ...valid.grading, reliability: 'Z' } } as unknown as SourceInput;
      expect(() => assertGraded(source)).toThrow(/not an Admiralty grade/);
    });

    it('with no record of who graded it', () => {
      // §E.10: never present a score without its provenance. That applies to the grade too.
      const source = { ...valid, grading: { ...valid.grading, gradedBy: '  ' } };
      expect(() => assertGraded(source)).toThrow(/who assigned its grade/);
    });

    it('with a credibility outside 1-6', () => {
      const source = {
        ...valid,
        chunks: [{ ...valid.chunks[0]!, credibility: 9 }],
      } as unknown as SourceInput;
      expect(() => assertGraded(source)).toThrow(/not 1-6/);
    });

    it('with an untagged chunk', () => {
      // Retrieval is situational. An untagged chunk is unreachable, so accepting it would
      // quietly grow a field that looks curated and cannot be retrieved from.
      const source = { ...valid, chunks: [{ ...valid.chunks[0]!, situationTags: [] }] };
      expect(() => assertGraded(source)).toThrow(/no situation tags/);
    });

    it('with an empty chunk', () => {
      const source = { ...valid, chunks: [{ ...valid.chunks[0]!, text: '   ' }] };
      expect(() => assertGraded(source)).toThrow(/is empty/);
    });

    it('with no chunks', () => {
      expect(() => assertGraded({ ...valid, chunks: [] })).toThrow(/produced no chunks/);
    });

    it('with no field binding', () => {
      expect(() => assertGraded({ ...valid, fieldId: '' })).toThrow(/bound to a field/);
    });
  });
});
