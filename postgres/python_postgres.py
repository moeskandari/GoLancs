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