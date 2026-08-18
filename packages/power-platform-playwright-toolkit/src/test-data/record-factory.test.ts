import { describe, it, expect } from 'vitest';
import { RecordFactory, uniqueRecordName, bindLookup } from './record-factory';

describe('RecordFactory.create', () => {
  it('builds a record with a generated value in the name field', () => {
    const record = RecordFactory.create({ nameField: 'nwind_ordernumber' });

    expect(typeof record.nwind_ordernumber).toBe('string');
    expect(record.nwind_ordernumber).toMatch(/^Test Record \d+-[a-z0-9]+$/);
  });

  it('uses a caller-supplied name prefix', () => {
    const record = RecordFactory.create({
      nameField: 'nwind_company',
      namePrefix: 'Test Customer',
    });

    expect(record.nwind_company).toMatch(/^Test Customer \d+-[a-z0-9]+$/);
  });

  it('merges additional data fields alongside the generated name', () => {
    const record = RecordFactory.create({
      nameField: 'nwind_ordernumber',
      data: { nwind_orderamount: 100 },
    });

    expect(record).toMatchObject({ nwind_orderamount: 100 });
    expect(record.nwind_ordernumber).toBeDefined();
  });

  it('lets the generated name field be overridden by explicit data', () => {
    const record = RecordFactory.create({
      nameField: 'nwind_ordernumber',
      data: { nwind_ordernumber: 'EXPLICIT-1' },
    });

    expect(record.nwind_ordernumber).toBe('EXPLICIT-1');
  });

  it('fits the generated name within maxLength, for tightly-constrained fields', () => {
    // Real-world case: nwind_ordernumber is a Dataverse text field with MaxLength 8 —
    // the default '<prefix> <timestamp>-<random>' form is far too long for it.
    const record = RecordFactory.create({ nameField: 'nwind_ordernumber', maxLength: 8 });

    expect((record.nwind_ordernumber as string).length).toBeLessThanOrEqual(8);
  });

  it('works for an entirely different entity without a dedicated subclass', () => {
    // Same RecordFactory, no AccountFactory/ContactFactory-style per-entity class needed.
    const order = RecordFactory.create({ nameField: 'nwind_ordernumber' });
    const customer = RecordFactory.create({
      nameField: 'nwind_company',
      namePrefix: 'Test Customer',
    });
    const employee = RecordFactory.create({
      nameField: 'nwind_lastname',
      namePrefix: 'Test Employee',
    });

    expect(order.nwind_ordernumber).not.toBe(customer.nwind_company);
    expect(customer.nwind_company).not.toBe(employee.nwind_lastname);
  });
});

describe('RecordFactory.createBulk', () => {
  it('creates the requested number of records', () => {
    const records = RecordFactory.createBulk(5, { nameField: 'nwind_company' });

    expect(records).toHaveLength(5);
  });

  it('produces collision-safe unique names across the batch', () => {
    const records = RecordFactory.createBulk(50, {
      nameField: 'nwind_ordernumber',
      namePrefix: 'Bulk Order',
    });

    const names = records.map((r) => r.nwind_ordernumber);
    expect(new Set(names).size).toBe(50);
  });

  it('numbers each record for readability', () => {
    const records = RecordFactory.createBulk(3, {
      nameField: 'nwind_company',
      namePrefix: 'Bulk Customer',
    });

    expect(records[0].nwind_company).toMatch(/^Bulk Customer 1 /);
    expect(records[1].nwind_company).toMatch(/^Bulk Customer 2 /);
    expect(records[2].nwind_company).toMatch(/^Bulk Customer 3 /);
  });

  it('carries the rest of the data payload onto every record', () => {
    const records = RecordFactory.createBulk(3, {
      nameField: 'nwind_ordernumber',
      data: { nwind_orderamount: 250 },
    });

    for (const record of records) {
      expect(record.nwind_orderamount).toBe(250);
    }
  });
});

describe('uniqueRecordName', () => {
  it('prefixes the generated name with the supplied prefix', () => {
    expect(uniqueRecordName('Test Account')).toMatch(/^Test Account \d+-[a-z0-9]+$/);
  });

  it('is collision-safe across a large number of rapid calls', () => {
    const names = Array.from({ length: 1000 }, () => uniqueRecordName('Test'));

    expect(new Set(names).size).toBe(1000);
  });

  it('falls back to a compact form that fits maxLength when the readable form does not', () => {
    const name = uniqueRecordName('Test Account', 8);

    expect(name.length).toBeLessThanOrEqual(8);
  });

  it('stays collision-safe even under a tight maxLength', () => {
    const names = Array.from({ length: 1000 }, () => uniqueRecordName('Test', 8));

    expect(names.every((n) => n.length <= 8)).toBe(true);
    expect(new Set(names).size).toBe(1000);
  });

  it('returns the readable form unchanged when it already fits maxLength', () => {
    const name = uniqueRecordName('X', 1000);

    expect(name).toMatch(/^X \d+-[a-z0-9]+$/);
  });
});

describe('bindLookup', () => {
  it('builds an @odata.bind payload from a navigation property, entity set, and id', () => {
    const bound = bindLookup('nwind_Customer', 'nwind_customers', 'guid-1');

    expect(bound).toEqual({ 'nwind_Customer@odata.bind': '/nwind_customers(guid-1)' });
  });
});
