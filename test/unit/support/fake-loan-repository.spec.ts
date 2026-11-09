import { FakeLoanRepository } from '../../support/fakes/fake-loan-repository';
import { describeLoanRepositoryContract } from '../../support/loan-repository-contract';

describeLoanRepositoryContract('FakeLoanRepository', async () => ({
  repo: new FakeLoanRepository(),
  ready: async () => undefined,
}));
