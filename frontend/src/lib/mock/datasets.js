// Single clean sample dataset for pipeline preview and schema inspection (~12 rows)
export const SAMPLE_DATASET = {
  id: 'sample-data',
  name: 'sample_data.csv',
  columns: [
    { name: 'customer_id', type: 'integer' },
    { name: 'full_name', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'age', type: 'integer' },
    { name: 'city', type: 'string' },
    { name: 'amount', type: 'float' },
    { name: 'signup_date', type: 'datetime' },
    { name: 'is_active', type: 'boolean' },
  ],
  beforeRows: [
    { customer_id: 101, full_name: '  Nguyen Van An  ', email: 'AN.NGUYEN@EXAMPLE.COM', age: 28, city: 'HANOI', amount: 150.50, signup_date: '2023-01-15 08:30:00', is_active: true },
    { customer_id: 102, full_name: 'tran thi mai', email: 'mai.tran@sample.org', age: null, city: 'hcmc', amount: 89.00, signup_date: '15/02/2023', is_active: true },
    { customer_id: 103, full_name: 'John Doe', email: 'john.doe@company.com', age: 34, city: 'NEW YORK', amount: 320.75, signup_date: '2023-03-01', is_active: false },
    { customer_id: 104, full_name: '  John Doe  ', email: 'john.doe@company.com', age: 34, city: 'New York', amount: 320.75, signup_date: '2023-03-01', is_active: false },
    { customer_id: 105, full_name: 'LE HOANG PHUC', email: 'phuc.le@mail.vn', age: 22, city: 'DA NANG', amount: 45.20, signup_date: '2023/04/10 14:20:00', is_active: true },
    { customer_id: 106, full_name: 'sarah connor', email: null, age: 45, city: 'london', amount: 510.00, signup_date: '2023-05-18', is_active: true },
    { customer_id: 107, full_name: 'sarah connor', email: 'sarah.c@sky.net', age: 45, city: 'London', amount: 510.00, signup_date: '2023-05-18', is_active: true },
    { customer_id: 108, full_name: 'PHAM MINH TRI', email: 'tri.pm@example.com', age: null, city: 'HANOI', amount: 75.00, signup_date: '06-20-2023', is_active: false },
    { customer_id: 109, full_name: 'Alice Johnson', email: 'alice.j@corp.io', age: 31, city: 'Boston', amount: 99.90, signup_date: '2023-07-22', is_active: true },
    { customer_id: 110, full_name: 'Vo Thi Sau', email: 'sau.vo@viet.vn', age: 29, city: 'HCMC', amount: 215.40, signup_date: '2023-08-30', is_active: true },
    { customer_id: 111, full_name: '  David Miller ', email: 'david.m@global.com', age: 39, city: 'seattle', amount: 180.00, signup_date: '2023-09-12', is_active: false },
    { customer_id: 112, full_name: 'bui duc anh', email: 'anh.bd@domain.vn', age: 26, city: 'can tho', amount: null, signup_date: '10/24/2023', is_active: true },
  ],
};

export const MOCK_DATASETS = [SAMPLE_DATASET];
