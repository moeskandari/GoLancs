# importing psycopg2 module
import psycopg2

# establishing the connection
conn = psycopg2.connect(
    database="group1db",
    user='postgres',
    password='group1',
    host='localhost',
    port='5050'
)

# creating a cursor object
cursor = conn.cursor()
# Create tables

operatorsSQL = "CREATE TABLE IF NOT EXISTS operators(operator_code TEXT PRIMARY KEY, name TEXT, mode TEXT);"

rail_schedule_SQL = "CREATE TABLE IF NOT EXISTS rail_schedule(train_uid TEXT PRIMARY KEY, operator_code TEXT, schedule_start_date DATE, schedule_end_date DATE, days_run BYTEA, CONSTRAINT fk_operator FOREIGN KEY (operator_code) REFERENCES operators(operator_code));"

cursor.execute(operatorsSQL)
cursor.execute(rail_schedule_SQL)



# list that contain records to be inserted into table
data = [('ARCT', 'Archway Travel'), ('BLAC', 'Blackpool Transport'), 
        ('KLCO', 'Kirby Londsdale Coach Hire'), ('SCCU', 'Stagecoach Cumbria & North Lancashire'),
        ('SCMY', 'Stagecoach Merseyside & South Lancashire'), ('NUTT', 'Transpora North West')]

# inserting record into employee table
for d in data:
    cursor.execute("INSERT into operators(operator_code, name, mode) VALUES (%s, %s, 'bus')", d)


print("List has been inserted to operators table successfully...")

# Commit your changes in the database
conn.commit()

# Closing the connection
conn.close()