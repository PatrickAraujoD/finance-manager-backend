import { Receipt } from '../../../../src/domain/entities/receipt';
import { NotFoundError } from '../../../../src/domain/errors';
import { Role } from '../../../../src/domain/role';
import { GetReceiptFile } from '../../../../src/application/use-cases/receipts/get-receipt-file';
import { FakeFileStorage } from '../../../support/fakes/fake-file-storage';
import { FakeReceiptRepository } from '../../../support/fakes/fake-receipt-repository';

const ana = { id: 'ana', role: 'N' as Role };
const bia = { id: 'bia', role: 'N' as Role };
const admin = { id: 'root', role: 'A' as Role };

async function setup(mimeType = 'application/pdf', ext = 'pdf') {
  const storage = new FakeFileStorage();
  const receipts = new FakeReceiptRepository();
  const content = Buffer.from('%PDF-1.4 conteudo');
  const storageKey = await storage.save(content, ext);
  await receipts.save(
    Receipt.create({
      id: 'r1',
      userId: 'ana',
      storageKey,
      mimeType,
      sizeBytes: content.length,
      suggestedAmount: null,
    }),
  );
  return { storage, receipts, content, useCase: new GetReceiptFile(receipts, storage) };
}

describe('GetReceiptFile', () => {
  it('returns the bytes, the stored mime type and a generated file name to the owner', async () => {
    const { useCase, content } = await setup();
    const out = await useCase.execute(ana, 'r1');
    expect(out.content.equals(content)).toBe(true);
    expect(out.mimeType).toBe('application/pdf');
    expect(out.fileName).toBe('comprovante.pdf');
  });

  it.each([
    ['image/png', 'png', 'comprovante.png'],
    ['image/jpeg', 'jpg', 'comprovante.jpg'],
  ])('names a %s receipt %s', async (mime, ext, name) => {
    const { useCase } = await setup(mime, ext);
    expect((await useCase.execute(ana, 'r1')).fileName).toBe(name);
  });

  it('answers NotFound for a receipt of another user, even an admin', async () => {
    const { useCase } = await setup();
    await expect(useCase.execute(bia, 'r1')).rejects.toThrow(NotFoundError);
    await expect(useCase.execute(admin, 'r1')).rejects.toThrow(NotFoundError);
  });

  it('answers NotFound for an unknown receipt, with the same message as another user receipt', async () => {
    const { useCase } = await setup();
    const other = await useCase.execute(bia, 'r1').catch((e: Error) => e);
    const unknown = await useCase.execute(ana, 'nope').catch((e: Error) => e);
    expect(unknown).toBeInstanceOf(NotFoundError);
    expect((unknown as Error).message).toBe((other as Error).message);
  });

  it('answers NotFound when the file vanished from storage', async () => {
    const { useCase, storage } = await setup();
    await storage.delete(storage.keys[0]);
    await expect(useCase.execute(ana, 'r1')).rejects.toThrow(NotFoundError);
  });
});
