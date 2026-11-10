import { FakeLoanPaymentRepository } from '../../support/fakes/fake-loan-payment-repository';
import { FakeLoanRepository } from '../../support/fakes/fake-loan-repository';
import { describeLoanPaymentRepositoryContract } from '../../support/loan-payment-repository-contract';

describeLoanPaymentRepositoryContract('FakeLoanPaymentRepository', async () => {
  const loans = new FakeLoanRepository();
  return { repo: new FakeLoanPaymentRepository(loans), loans, ready: async () => undefined };
});
